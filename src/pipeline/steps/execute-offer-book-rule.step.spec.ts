import type { EntityManager } from 'typeorm';
import { OfferBookRuleExecutionReportEntity } from '../../database/entities/tenant/offer-book-rule-execution-report.entity';
import { OfferBookRuleEntity } from '../../database/entities/tenant/offer-book-rule.entity';
import type { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import type { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { DuplicateDeliveryRepublishError } from '../../queue/retry.service';
import type { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { ExecuteOfferBookRuleStep } from './execute-offer-book-rule.step';

interface PendingRow {
  id: string;
  ean: string;
  finalPrice: string;
  externalId: string | null;
}

interface Counts {
  applied: number;
  erpApplied: number;
  failed: number;
  pending: number;
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

const makeStepEm = (opts: {
  pendingBatches?: PendingRow[][];
  erpAppliedBatches?: PendingRow[][];
  counts: Counts;
  report?: typeof REPORT | null;
  lockAcquired?: boolean;
  mirrorError?: Error;
  finalizeAffected?: number;
  campaignValid?: boolean;
}): {
  em: EntityManager;
  tx: TenantTransactionService;
  marks: unknown[][];
  reportUpdate: () => unknown[] | null;
  ruleUpdate: () => Record<string, unknown> | null;
  offerBookUpsert: jest.Mock;
  mirrorCalls: () => number;
} => {
  let pendingCall = 0;
  let erpAppliedCall = 0;
  let mirrors = 0;
  const marks: unknown[][] = [];
  let reportUpdate: unknown[] | null = null;
  let ruleUpdate: Record<string, unknown> | null = null;
  const offerBookUpsert = opts.mirrorError
    ? jest.fn().mockRejectedValue(opts.mirrorError)
    : jest.fn().mockResolvedValue(undefined);

  const reportRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(opts.report === undefined ? REPORT : opts.report),
  };
  const ruleRepo = {
    exists: jest.fn().mockResolvedValue(true),
    update: jest.fn((_where: unknown, values: Record<string, unknown>) => {
      if ('status' in values) {
        ruleUpdate = values;
        return Promise.resolve({ affected: opts.finalizeAffected ?? 1 });
      }
      return Promise.resolve({ affected: 1 });
    }),
  };

  const em = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === OfferBookRuleExecutionReportEntity) return reportRepo;
      if (entity === OfferBookRuleEntity) return ruleRepo;
      return { upsert: offerBookUpsert };
    }),
    query: jest.fn((sql: string, params?: unknown[]) => {
      if (sql.includes('pg_try_advisory_xact_lock'))
        return Promise.resolve([
          { locked: opts.lockAcquired === undefined || opts.lockAcquired },
        ]);
      if (sql.includes('FROM tenant_offer_campaign'))
        return Promise.resolve([
          { valid: opts.campaignValid === undefined || opts.campaignValid },
        ]);
      if (sql.includes('SELECT i.id')) {
        const status = params?.[1];
        if (status === 'erp_applied') {
          const batch = opts.erpAppliedBatches?.[erpAppliedCall] ?? [];
          erpAppliedCall++;
          return Promise.resolve(batch);
        }
        const batch = opts.pendingBatches?.[pendingCall] ?? [];
        pendingCall++;
        return Promise.resolve(batch);
      }
      if (sql.includes('SELECT id FROM')) {
        const ids = (opts.pendingBatches ?? [])
          .flat()
          .map((row) => ({ id: row.id }));
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
      if (sql.includes('UPDATE product_item')) {
        mirrors++;
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }),
  } as unknown as EntityManager;

  const tx = {
    runWithTenant: jest.fn(
      async (
        _schema: string,
        fn: (manager: EntityManager) => Promise<unknown>,
      ) => fn(em),
    ),
  } as unknown as TenantTransactionService;

  return {
    em,
    tx,
    marks,
    reportUpdate: () => reportUpdate,
    ruleUpdate: () => ruleUpdate,
    offerBookUpsert,
    mirrorCalls: () => mirrors,
  };
};

const makeStep = (opts: {
  tx: TenantTransactionService;
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
  return {
    step: new ExecuteOfferBookRuleStep(integration, a7, opts.tx),
    upsertOffer,
  };
};

const finalCounts = (over: Partial<Counts> = {}): Counts => ({
  applied: 0,
  erpApplied: 0,
  failed: 0,
  pending: 0,
  skipped: 0,
  total: 0,
  ...over,
});

describe('ExecuteOfferBookRuleStep', () => {
  it('checkpointa a A7, espelha e finaliza SUCCESS/SUCCEEDED', async () => {
    const mock = makeStepEm({
      pendingBatches: [[item()], []],
      counts: finalCounts({ applied: 1, total: 1 }),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).toHaveBeenCalledTimes(1);
    expect(upsertOffer).toHaveBeenCalledWith(CREDS, 47, [
      { idEmbalagem: 6001, precoOferta: 9.5 },
    ]);
    const itemRead = (mock.em.query as jest.Mock).mock.calls.find(
      ([sql]: [string]) => sql.includes('SELECT i.id'),
    )?.[0] as string;
    expect(itemRead).toContain('i.external_id AS "externalId"');
    expect(itemRead).not.toContain('JOIN product');
    expect(mock.offerBookUpsert).toHaveBeenCalledTimes(1);
    expect(mock.mirrorCalls()).toBe(1);
    expect(mock.marks).toEqual([
      [['item-1'], 'erp_applied', null],
      [['item-1'], 'applied', null],
    ]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 1, 1, 0, 'SUCCESS', 0]);
    expect(mock.ruleUpdate()).toMatchObject({
      status: 'SUCCEEDED',
      activeExecutionReportId: null,
    });
  });

  it('falha da A7 vira failed sem checkpoint ERP', async () => {
    const mock = makeStepEm({
      pendingBatches: [[item()], []],
      counts: finalCounts({ failed: 1, total: 1 }),
    });
    const { step } = makeStep({
      tx: mock.tx,
      upsertOffer: jest.fn().mockRejectedValue(new Error('erp down')),
    });

    await expect(step.run(mock.em, 'slug', REPORT.id)).resolves.toBeUndefined();

    expect(mock.marks).toEqual([[['item-1'], 'failed', 'erro_transitorio']]);
    expect(mock.mirrorCalls()).toBe(0);
    expect(mock.ruleUpdate()).toMatchObject({ status: 'ERRORED' });
  });

  it('falha parcial produz FAILURE + PARTIALLY_SUCCEEDED', async () => {
    const mock = makeStepEm({
      pendingBatches: [
        [item()],
        [item({ id: 'item-2', ean: '7890000000002', externalId: '6002' })],
        [],
      ],
      counts: finalCounts({ applied: 1, failed: 1, total: 2 }),
    });
    const { step } = makeStep({
      tx: mock.tx,
      upsertOffer: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('erp down')),
    });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(mock.marks).toEqual([
      [['item-1'], 'erp_applied', null],
      [['item-1'], 'applied', null],
      [['item-2'], 'failed', 'erro_transitorio'],
    ]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 2, 1, 0, 'FAILURE', 1]);
    expect(mock.ruleUpdate()).toMatchObject({
      status: 'PARTIALLY_SUCCEEDED',
    });
  });

  it('item sem external_id vira failed sem push', async () => {
    const mock = makeStepEm({
      pendingBatches: [[item({ externalId: null })], []],
      counts: finalCounts({ failed: 1, total: 1 }),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.marks).toEqual([[['item-1'], 'failed', 'sem_external_id']]);
  });

  it('sem credenciais A7: pendentes viram a7_nao_configurado', async () => {
    const mock = makeStepEm({
      pendingBatches: [[item()]],
      counts: finalCounts({ failed: 1, total: 1 }),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx, creds: null });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.marks).toEqual([[['item-1'], 'failed', 'a7_nao_configurado']]);
  });

  it('redelivery de erp_applied refaz só o mirror, sem A7', async () => {
    const mock = makeStepEm({
      erpAppliedBatches: [[item()], []],
      pendingBatches: [[]],
      counts: finalCounts({ applied: 1, total: 1 }),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.offerBookUpsert).toHaveBeenCalledTimes(1);
    expect(mock.marks).toEqual([[['item-1'], 'applied', null]]);
  });

  it('campanha inválida reconcilia erp_applied e cancela somente pending', async () => {
    const mock = makeStepEm({
      erpAppliedBatches: [[item()], []],
      pendingBatches: [
        [item({ id: 'item-2', ean: '7890000000002', externalId: '6002' })],
      ],
      campaignValid: false,
      counts: finalCounts({ applied: 1, failed: 1, total: 2 }),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await step.run(mock.em, 'slug', REPORT.id);

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.marks).toEqual([
      [['item-1'], 'applied', null],
      [['item-2'], 'failed', 'campanha_nao_vigente'],
    ]);
    expect(mock.reportUpdate()).toEqual([REPORT.id, 2, 1, 0, 'FAILURE', 1]);
    expect(mock.ruleUpdate()).toMatchObject({
      status: 'PARTIALLY_SUCCEEDED',
    });
  });

  it('erro do mirror após sucesso A7 preserva erp_applied e propaga para DLQ', async () => {
    const mock = makeStepEm({
      pendingBatches: [[item()]],
      counts: finalCounts({ erpApplied: 1, total: 1 }),
      mirrorError: new Error('db down'),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await expect(step.run(mock.em, 'slug', REPORT.id)).rejects.toThrow(
      'db down',
    );

    expect(upsertOffer).toHaveBeenCalledTimes(1);
    expect(mock.marks).toEqual([[['item-1'], 'erp_applied', null]]);
  });

  it('não finaliza enquanto ainda houver pending/erp_applied', async () => {
    const mock = makeStepEm({
      pendingBatches: [[]],
      counts: finalCounts({ pending: 1, total: 1 }),
    });
    const { step } = makeStep({ tx: mock.tx });

    await expect(step.run(mock.em, 'slug', REPORT.id)).rejects.toThrow(
      'ainda tem 1 pending',
    );
    expect(mock.ruleUpdate()).toBeNull();
  });

  it('um finalizador sem ownership não altera a regra', async () => {
    const mock = makeStepEm({
      pendingBatches: [[]],
      counts: finalCounts(),
      finalizeAffected: 0,
    });
    const { step } = makeStep({ tx: mock.tx });

    await expect(step.run(mock.em, 'slug', REPORT.id)).rejects.toThrow(
      'perdeu ownership ao finalizar',
    );
  });

  it('advisory lock ocupado roteia a duplicata para DLQ', async () => {
    const mock = makeStepEm({
      lockAcquired: false,
      counts: finalCounts(),
    });
    const { step } = makeStep({ tx: mock.tx });

    await expect(step.run(mock.em, 'slug', REPORT.id)).rejects.toBeInstanceOf(
      DuplicateDeliveryRepublishError,
    );
  });

  it('report inexistente/finalizado retorna sem tocar A7', async () => {
    const mock = makeStepEm({
      report: null,
      counts: finalCounts(),
    });
    const { step, upsertOffer } = makeStep({ tx: mock.tx });

    await step.run(mock.em, 'slug', 'rep-missing');

    expect(upsertOffer).not.toHaveBeenCalled();
    expect(mock.reportUpdate()).toBeNull();
  });
});
