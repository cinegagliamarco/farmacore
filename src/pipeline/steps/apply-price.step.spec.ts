import { BadGatewayException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApplyPriceStep } from './apply-price.step';
import { CatalogMutationService } from '../../tenant-api/catalog/catalog-mutation.service';

interface ItemSeed {
  id: string;
  ean: string;
  target: 'precoVenda' | 'precoOferta';
  price: string;
  cadernoId: string | null;
}

interface Mark {
  id: string;
  status: string;
  reason: string | null;
  erp: string | null;
}

/** Mock EntityManager que despacha por SQL: lê os itens, responde campanha,
 *  e captura os UPDATEs de mark/contadores. */
function makeEm(items: ItemSeed[], campaignEans: Set<string> = new Set()) {
  const marks: Mark[] = [];
  let counters: { applied: number; skipped: number; failed: number } | null =
    null;
  const em = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (/FROM pricing_apply_item\s+WHERE apply_run_id/.test(sql)) {
        return items;
      }
      if (/FROM offer_book/.test(sql)) {
        return campaignEans.has(String(params[0])) ? [{ x: 1 }] : [];
      }
      if (/UPDATE pricing_apply_item/.test(sql)) {
        marks.push({
          id: params[0] as string,
          status: params[1] as string,
          reason: params[2] as string | null,
          erp: params[3] as string | null,
        });
        return [];
      }
      if (/UPDATE pricing_apply_run/.test(sql)) {
        counters = {
          applied: params[1] as number,
          skipped: params[2] as number,
          failed: params[3] as number,
        };
        return [];
      }
      return [];
    }),
  } as unknown as EntityManager;
  return { em, marks, counters: () => counters };
}

const item = (over: Partial<ItemSeed> = {}): ItemSeed => ({
  id: 'i1',
  ean: '7890000000001',
  target: 'precoVenda',
  price: '10.00',
  cadernoId: null,
  ...over,
});

describe('ApplyPriceStep.run', () => {
  let mutation: { updatePrice: jest.Mock; upsertOffer: jest.Mock };
  let step: ApplyPriceStep;

  beforeEach(() => {
    mutation = { updatePrice: jest.fn(), upsertOffer: jest.fn() };
    step = new ApplyPriceStep(mutation as unknown as CatalogMutationService);
  });

  it('BadGatewayException (ERP write failed) vira failed/erro_transitorio', async () => {
    mutation.updatePrice.mockRejectedValue(
      new BadGatewayException('ERP write failed'),
    );
    const { em, marks, counters } = makeEm([item()]);
    await step.run(em, 'acme', 'run1', 1);
    expect(marks[0]).toMatchObject({
      status: 'failed',
      reason: 'erro_transitorio',
    });
    expect(counters()).toEqual({ applied: 0, skipped: 0, failed: 1 });
  });

  it('aplica precoVenda no ERP e marca applied', async () => {
    mutation.updatePrice.mockResolvedValue({ ean: '7890000000001', price: 10 });
    const { em, marks, counters } = makeEm([item()]);
    await step.run(em, 'acme', 'run1', 1);
    expect(mutation.updatePrice).toHaveBeenCalledWith(
      em,
      'acme',
      '7890000000001',
      10,
    );
    expect(marks[0]).toMatchObject({ status: 'applied', reason: null });
    expect(counters()).toEqual({ applied: 1, skipped: 0, failed: 0 });
  });

  it('aplica precoOferta via upsertOffer', async () => {
    mutation.upsertOffer.mockResolvedValue({
      ean: 'x',
      targetPrice: 7,
      cadernoId: 99,
    });
    const { em, marks } = makeEm([
      item({ target: 'precoOferta', price: '7.00', cadernoId: '99' }),
    ]);
    await step.run(em, 'acme', 'run1', 1);
    expect(mutation.upsertOffer).toHaveBeenCalledWith(
      em,
      'acme',
      '7890000000001',
      {
        targetPrice: 7,
        cadernoId: 99,
      },
    );
    expect(marks[0].status).toBe('applied');
  });

  it('produto monitorado (ConflictException) → skipped, sem re-throw', async () => {
    mutation.updatePrice.mockRejectedValue(
      new ConflictException('product is monitored; price is locked'),
    );
    const { em, marks, counters } = makeEm([item()]);
    await expect(step.run(em, 'acme', 'run1', 1)).resolves.toBeUndefined();
    expect(marks[0]).toMatchObject({ status: 'skipped', reason: 'monitored' });
    expect(counters()).toEqual({ applied: 0, skipped: 1, failed: 0 });
  });

  it('erro transitório (não-Http) → failed/erro_transitorio, sem re-throw', async () => {
    mutation.updatePrice.mockRejectedValue(new Error('ECONNRESET'));
    const { em, marks, counters } = makeEm([item()]);
    await expect(step.run(em, 'acme', 'run1', 1)).resolves.toBeUndefined();
    expect(marks[0]).toMatchObject({
      status: 'failed',
      reason: 'erro_transitorio',
    });
    expect(counters()).toEqual({ applied: 0, skipped: 0, failed: 1 });
  });

  it('EAN em campanha ativa → skipped em_campanha, sem chamar o ERP', async () => {
    const { em, marks } = makeEm([item()], new Set(['7890000000001']));
    await step.run(em, 'acme', 'run1', 1);
    expect(mutation.updatePrice).not.toHaveBeenCalled();
    expect(marks[0]).toMatchObject({
      status: 'skipped',
      reason: 'em_campanha',
    });
  });

  it('lote misto: contadores corretos', async () => {
    mutation.updatePrice
      .mockResolvedValueOnce({ ean: 'a', price: 10 }) // i1 applied
      .mockRejectedValueOnce(
        new ConflictException('product has no ERP external_id'),
      ); // i2 skipped sem_external_id
    const { em, counters } = makeEm([
      item({ id: 'i1', ean: '7890000000001' }),
      item({ id: 'i2', ean: '7890000000002' }),
    ]);
    await step.run(em, 'acme', 'run1', 1);
    expect(counters()).toEqual({ applied: 1, skipped: 1, failed: 0 });
  });
});
