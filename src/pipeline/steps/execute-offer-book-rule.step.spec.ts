import type { EntityManager } from 'typeorm';
import type { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import type { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { ExecuteOfferBookRuleStep } from './execute-offer-book-rule.step';

interface PendingRow {
  id: string;
  ean: string;
  finalPrice: string;
  externalId: string | null;
}

interface Counts {
  applied: number;
  failed: number;
  skipped: number;
  total: number;
}

const REPORT = { id: 'rep-1', ruleId: 'rule-1', offerBookInfoId: '47' };
const CREDS = { baseUrl: 'https://erp.test', apiKey: 'key' };

const item = (over: Partial<PendingRow> = {}): PendingRow => ({
  id: 'item-1',
  ean: '7890000000001',
  finalPrice: '9.50',
  externalId: '6001',
  ...over,
});

/**
 * em mock dirigido por fragmento de SQL: `pendingBatches` alimenta o SELECT
 * dos pendentes (uma entrada por chamada) e `counts` o finalize. Captura os
 * UPDATEs de mark/report/rule para asserção.
 */
const makeStepEm = (opts: {
  pendingBatches: PendingRow[][];
  counts: Counts;
  report?: typeof REPORT | null;
}): {
  em: EntityManager;
  marks: unknown[][];
  reportUpdate: () => unknown[] | null;
  ruleUpdate: () => unknown[] | null;
  offerBookUpsert: jest.Mock;
  mirrorCalls: () => number;
} => {
  let pendingCall = 0;
  let mirrors = 0;
  const marks: unknown[][] = [];
  let reportUpdate: unknown[] | null = null;
  let ruleUpdate: unknown[] | null = null;
  const offerBookUpsert = jest.fn().mockResolvedValue(undefined);

  const em = {
    getRepository: jest.fn(() => ({
      findOne: jest
        .fn()
        .mockResolvedValue(opts.report === undefined ? REPORT : opts.report),
      upsert: offerBookUpsert,
    })),
    query: jest.fn((sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT i.id')) {
        const batch = opts.pendingBatches[pendingCall] ?? [];
        pendingCall++;
        return Promise.resolve(batch);
      }
      if (sql.includes('SELECT id FROM')) {
        const ids = opts.pendingBatches.flat().map((i) => ({ id: i.id }));
        return Promise.resolve(ids);
      }
      if (sql.includes('count(*) FILTER'))
        return Promise.resolve([opts.counts]);
      if (sql.includes('UPDATE offer_book_rule_execution_report_item')) {
        marks.push(params ?? []);
        return Promise.resolve([]);
      }
      if (sql.includes('UPDATE offer_book_rule_execution_report')) {
        reportUpdate = params ?? [];
        return Promise.resolve([]);
      }
      if (sql.includes('UPDATE offer_book_rule SET status')) {
        ruleUpdate = params ?? [];
        return Promise.resolve([]);
      }
      if (sql.includes('UPDATE product_item')) {
        mirrors++;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;

  return {
    em,
    marks,
    reportUpdate: () => reportUpdate,
    ruleUpdate: () => ruleUpdate,
    offerBookUpsert,
    mirrorCalls: () => mirrors,
  };
};

const makeStep = (opts: {
  creds?: typeof CREDS | null;
  upsertOffer?: jest.Mock;
}): { step: ExecuteOfferBookRuleStep; upsertOffer: jest.Mock } => {
  const upsertOffer =
    opts.upsertOffer ?? jest.fn().mockResolvedValue(undefined);
  const integration = {
    getApiCredentials: jest
      .fn()
      .mockResolvedValue(opts.creds === undefined ? CREDS : opts.creds),
  } as unknown as IntegrationConnectionService;
  const a7 = { upsertOffer } as unknown as A7PharmaApiClient;
  return { step: new ExecuteOfferBookRuleStep(integration, a7), upsertOffer };
};

describe('ExecuteOfferBookRuleStep', () => {
  it('empurra o chunk congelado à A7, espelha e finaliza SUCCESS/SUCCEEDED', async () => {
    const { step, upsertOffer } = makeStep({});
    const mock = makeStepEm({
      pendingBatches: [[item()], []],
      counts: { applied: 1, failed: 0, skipped: 0, total: 1 },
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).toHaveBeenCalledTimes(1);
    expect(upsertOffer).toHaveBeenCalledWith(CREDS, 47, [
      { idEmbalagem: 6001, precoOferta: 9.5 },
    ]);
    expect(mock.offerBookUpsert).toHaveBeenCalledTimes(1);
    expect(mock.mirrorCalls()).toBe(1);
    expect(mock.marks).toEqual([[['item-1'], 'applied', null]]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 1, 1, 0, 'SUCCESS', 0]);
    expect(mock.ruleUpdate()).toEqual([REPORT.ruleId, 'SUCCEEDED']);
  });

  it('falha da A7 vira item failed sem re-lançar (money-safe)', async () => {
    const { step } = makeStep({
      upsertOffer: jest.fn().mockRejectedValue(new Error('erp down')),
    });
    const mock = makeStepEm({
      pendingBatches: [[item()], []],
      counts: { applied: 0, failed: 1, skipped: 0, total: 1 },
    });

    await expect(step.run(mock.em, 'slug', REPORT.id)).resolves.toBeUndefined();

    expect(mock.marks).toEqual([[['item-1'], 'failed', 'erro_transitorio']]);
    expect(mock.mirrorCalls()).toBe(0);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 1, 0, 0, 'FAILURE', 1]);
    expect(mock.ruleUpdate()).toEqual([REPORT.ruleId, 'ERRORED']);
  });

  it('falha parcial (um chunk ok, outro não) → FAILURE + PARTIALLY_SUCCEEDED', async () => {
    const { step } = makeStep({
      upsertOffer: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('erp down')),
    });
    const mock = makeStepEm({
      pendingBatches: [
        [item()],
        [item({ id: 'item-2', ean: '7890000000002', externalId: '6002' })],
        [],
      ],
      counts: { applied: 1, failed: 1, skipped: 0, total: 2 },
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(mock.marks).toEqual([
      [['item-1'], 'applied', null],
      [['item-2'], 'failed', 'erro_transitorio'],
    ]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 2, 1, 0, 'FAILURE', 1]);
    expect(mock.ruleUpdate()).toEqual([REPORT.ruleId, 'PARTIALLY_SUCCEEDED']);
  });

  it('item sem external_id vira failed sem push', async () => {
    const { step, upsertOffer } = makeStep({});
    const mock = makeStepEm({
      pendingBatches: [[item({ externalId: null })], []],
      counts: { applied: 0, failed: 1, skipped: 0, total: 1 },
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.marks).toEqual([[['item-1'], 'failed', 'sem_external_id']]);
    expect(mock.ruleUpdate()).toEqual([REPORT.ruleId, 'ERRORED']);
  });

  it('sem credenciais A7: pendentes viram a7_nao_configurado, sem push', async () => {
    const { step, upsertOffer } = makeStep({ creds: null });
    const mock = makeStepEm({
      pendingBatches: [[item()]],
      counts: { applied: 0, failed: 1, skipped: 0, total: 1 },
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.marks).toEqual([[['item-1'], 'failed', 'a7_nao_configurado']]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 1, 0, 0, 'FAILURE', 1]);
  });

  it('redelivery sem pendentes: finaliza direto, sem novo push (NO_CHANGES quando só skips)', async () => {
    const { step, upsertOffer } = makeStep({});
    const mock = makeStepEm({
      pendingBatches: [[]],
      counts: { applied: 0, failed: 0, skipped: 2, total: 2 },
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.reportUpdate()).toEqual([REPORT.id, 2, 0, 2, 'NO_CHANGES', 0]);
    expect(mock.ruleUpdate()).toEqual([REPORT.ruleId, 'SUCCEEDED']);
  });

  it('report inexistente (regra deletada): retorna sem tocar nada', async () => {
    const { step, upsertOffer } = makeStep({});
    const mock = makeStepEm({
      pendingBatches: [],
      counts: { applied: 0, failed: 0, skipped: 0, total: 0 },
      report: null,
    });

    await step.run(mock.em, 'slug', 'rep-missing');

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.reportUpdate()).toBeNull();
    expect(mock.ruleUpdate()).toBeNull();
  });
});
