import { BadGatewayException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ApplyPriceStep } from './apply-price.step';
import { CatalogMutationService } from '../../tenant-api/catalog/catalog-mutation.service';

interface ItemSeed {
  id: string;
  ean: string;
  target: 'precoVenda' | 'precoOferta';
  storeId?: string | null;
  price: string;
  cadernoId: string | null;
}

interface Mark {
  id: string;
  status: string;
  reason: string | null;
  erp: string | null;
}

/** Mock EntityManager que despacha por SQL: lê os itens, responde a linha
 *  product_item da loja, campanha (global por EAN e por caderno), lojas do
 *  caderno, e captura os UPDATEs de mark/contadores. */
function makeEm(
  items: ItemSeed[],
  campaignEans: Set<string> = new Set(),
  cadernoStores: string[] = [],
  opts: {
    /** `ean|storeId` → offer_external_id da linha da loja (null = linha sem
     *  caderno); chave ausente = loja SEM linha product_item. */
    piOffers?: Map<string, string | null>;
    /** Cadernos com campanha ativa (checagem por loja). */
    campaignCadernos?: Set<string>;
  } = {},
) {
  const marks: Mark[] = [];
  let counters: { applied: number; skipped: number; failed: number } | null =
    null;
  const em = {
    query: jest.fn((sql: string, params: unknown[]) => {
      if (/FROM pricing_apply_item\s+WHERE apply_run_id/.test(sql)) {
        return items;
      }
      if (/core\.tenant_store/.test(sql)) {
        return cadernoStores.map((name) => ({ name }));
      }
      if (/AS "offerExternalId"/.test(sql)) {
        // Batched (storeCadernos): params = [eans[], storeIds[]].
        const eans = new Set((params[0] as string[]).map(String));
        const lojas = new Set((params[1] as string[]).map(String));
        return [...(opts.piOffers ?? new Map<string, string | null>())]
          .map(([key, offerExternalId]) => {
            const [ean, storeId] = key.split('|');
            return { ean, storeId, offerExternalId };
          })
          .filter((r) => eans.has(r.ean) && lojas.has(r.storeId));
      }
      if (/FROM offer_book/.test(sql)) {
        return (params[0] as string[])
          .filter((ean) => campaignEans.has(String(ean)))
          .map((ean) => ({ ean: String(ean) }));
      }
      if (/FROM tenant_offer_campaign/.test(sql)) {
        // Batched (activeCampaignCadernos): params[0] = cadernos[].
        return (params[0] as string[])
          .filter((c) => opts.campaignCadernos?.has(String(c)))
          .map((id) => ({ id: String(id) }));
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
  storeId: null,
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
      undefined,
    );
    expect(marks[0]).toMatchObject({ status: 'applied', reason: null });
    expect(counters()).toEqual({ applied: 1, skipped: 0, failed: 0 });
  });

  it('item com loja aplica precoVenda NAQUELA loja (storeId ao ERP)', async () => {
    mutation.updatePrice.mockResolvedValue({
      ean: '7890000000001',
      price: 10,
      storeId: 's1',
    });
    const { em, marks } = makeEm([item({ storeId: 's1' })]);
    await step.run(em, 'acme', 'run1', 1);
    expect(mutation.updatePrice).toHaveBeenCalledWith(
      em,
      'acme',
      '7890000000001',
      10,
      's1',
    );
    expect(marks[0]).toMatchObject({ status: 'applied' });
    expect(marks[0].erp).toContain('@loja=s1');
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
    // Item global mantém o espelho offer_book (storeScoped=false).
    expect(mutation.upsertOffer).toHaveBeenCalledWith(
      em,
      'acme',
      '7890000000001',
      {
        targetPrice: 7,
        cadernoId: 99,
      },
      false,
    );
    expect(marks[0].status).toBe('applied');
  });

  it('oferta por loja anota as lojas cobertas pelo caderno (D5) e NÃO reescreve o espelho global', async () => {
    mutation.upsertOffer.mockResolvedValue({
      ean: 'x',
      targetPrice: 7,
      cadernoId: 99,
    });
    const { em, marks } = makeEm(
      [
        item({
          target: 'precoOferta',
          price: '7.00',
          cadernoId: '99',
          storeId: 's1',
        }),
      ],
      new Set(),
      ['Loja Centro', 'Loja Sul'],
    );
    await step.run(em, 'acme', 'run1', 1);
    expect(marks[0].status).toBe('applied');
    expect(marks[0].erp).toBe(
      'precoOferta=7@caderno=99;lojas=Loja Centro,Loja Sul',
    );
    // storeScoped=true: o caderno da loja pode nem cobrir a rede — o espelho
    // global offer_book fica intocado.
    expect(mutation.upsertOffer).toHaveBeenCalledWith(
      em,
      'acme',
      '7890000000001',
      { targetPrice: 7, cadernoId: 99 },
      true,
    );
  });

  it('loja inativa (ConflictException) → skipped loja_inativa', async () => {
    mutation.updatePrice.mockRejectedValue(
      new ConflictException('store s1 is inactive'),
    );
    const { em, marks, counters } = makeEm([item({ storeId: 's1' })]);
    await step.run(em, 'acme', 'run1', 1);
    expect(marks[0]).toMatchObject({
      status: 'skipped',
      reason: 'loja_inativa',
    });
    expect(counters()).toEqual({ applied: 0, skipped: 1, failed: 0 });
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

  it('item de loja: campanha no caderno vencedor DA LOJA → skipped em_campanha', async () => {
    const { em, marks } = makeEm([item({ storeId: 's1' })], new Set(), [], {
      piOffers: new Map([['7890000000001|s1', '77']]),
      campaignCadernos: new Set(['77']),
    });
    await step.run(em, 'acme', 'run1', 1);
    expect(mutation.updatePrice).not.toHaveBeenCalled();
    expect(marks[0]).toMatchObject({
      status: 'skipped',
      reason: 'em_campanha',
    });
  });

  it('item de loja: campanha só no caderno de OUTRA loja não trava a venda', async () => {
    mutation.updatePrice.mockResolvedValue({ ean: '7890000000001', price: 10 });
    const { em, marks } = makeEm([item({ storeId: 's1' })], new Set(), [], {
      piOffers: new Map([['7890000000001|s1', '88']]),
      campaignCadernos: new Set(['77']),
    });
    await step.run(em, 'acme', 'run1', 1);
    expect(marks[0]).toMatchObject({ status: 'applied' });
  });

  it('item de loja SEM linha product_item cai na checagem GLOBAL de campanha', async () => {
    const { em, marks } = makeEm(
      [item({ storeId: 's1' })],
      new Set(['7890000000001']),
    );
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
