import { EntityManager } from 'typeorm';
import { PricingApplyService } from './pricing-apply.service';
import type {
  SuggestionRulesService,
  SuggestionRuleApi,
} from './suggestion-rules.service';
import type { ClustersService } from './clusters.service';
import type { ClassificationsService } from '../config/classifications.service';
import type { OutboxRepository } from '../../queue/outbox.repository';

interface ProductSeed {
  ean: string;
  cost: string | null;
  precoVenda: string | null;
  precoOferta: string | null;
  cadernoId: string | null;
}

interface StoreItemSeed {
  ean: string;
  storeId: string;
  price: string | null;
  cost: string | null;
  priceOffer: string | null;
  offerExternalId: string | null;
}

/** Mock em que despacha por SQL: tenant, origens (vazias), lojas, linhas
 *  product_item da loja e os produtos do lote. */
const makeEm = (
  products: ProductSeed[],
  stores: Array<{ id: string; active: boolean }> = [],
  storeItems: StoreItemSeed[] = [],
): EntityManager =>
  ({
    query: jest.fn((sql: string) => {
      if (/FROM core\.tenant\s+WHERE slug/.test(sql)) {
        return Promise.resolve([{ id: 't-1' }]);
      }
      if (/core\.tenant_competitor_origin/.test(sql)) {
        return Promise.resolve([]);
      }
      if (/FROM core\.tenant_store/.test(sql)) return Promise.resolve(stores);
      if (/FROM product_item pi/.test(sql)) return Promise.resolve(storeItems);
      if (/FROM product p/.test(sql)) {
        return Promise.resolve(
          products.map((p) => ({
            ...p,
            classificationId: null,
            classificacao: null,
          })),
        );
      }
      return Promise.resolve([]);
    }),
  }) as unknown as EntityManager;

const margemRule = (
  over: Partial<SuggestionRuleApi> = {},
): SuggestionRuleApi => ({
  id: 'r1',
  name: 'margem 50',
  classifications: [],
  storeIds: [],
  clusterId: null,
  clusterName: null,
  excludeClusterIds: [],
  strategy: 'margem',
  minMargin: 50,
  competitorMode: 'weighted',
  competitors: [],
  variationPct: 0,
  noCompetitorMargin: null,
  priceControlled: false,
  ignorePbm: false,
  blockPbmInMargin: false,
  cascadeByPriority: false,
  applyRounding: false,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const buildService = (
  rules: SuggestionRuleApi[] = [],
  outbox: OutboxRepository = {
    insertMany: jest.fn(),
  } as unknown as OutboxRepository,
) =>
  new PricingApplyService(
    {
      list: jest.fn().mockResolvedValue(rules),
    } as unknown as SuggestionRulesService,
    {
      loadActiveClusterMembership: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ClustersService,
    outbox,
    {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as ClassificationsService,
  );

const PRODUCT: ProductSeed = {
  ean: '789',
  cost: '5.00',
  precoVenda: '10.00',
  precoOferta: '8.00',
  cadernoId: '55',
};

describe('PricingApplyService revalidação por loja (via preview)', () => {
  it('loja desconhecida/inativa rejeita o item com o motivo e a loja', async () => {
    const service = buildService();
    const em = makeEm([PRODUCT], [{ id: 's-inativa', active: false }]);
    const out = await service.preview(em, 'acme', [
      { ean: '789', target: 'precoVenda', price: 10, storeId: 's-fantasma' },
      { ean: '789', target: 'precoVenda', price: 10, storeId: 's-inativa' },
    ]);
    expect(out.accepted).toHaveLength(0);
    expect(out.rejected).toEqual([
      { ean: '789', reason: 'loja_invalida', storeId: 's-fantasma' },
      { ean: '789', reason: 'loja_inativa', storeId: 's-inativa' },
    ]);
  });

  it('piso de margem usa o CUSTO DA LOJA (não o global)', async () => {
    // Regra margem 50%: piso global = 5/(1-0.5) = 10; piso da loja (custo 8) = 16.
    const service = buildService([margemRule()]);
    const em = makeEm(
      [PRODUCT],
      [{ id: 's1', active: true }],
      [
        {
          ean: '789',
          storeId: 's1',
          price: '12.00',
          cost: '8.00',
          priceOffer: null,
          offerExternalId: null,
        },
      ],
    );
    const out = await service.preview(em, 'acme', [
      { ean: '789', target: 'precoVenda', price: 12, storeId: 's1' },
      { ean: '789', target: 'precoVenda', price: 12 },
    ]);
    expect(out.rejected).toEqual([
      { ean: '789', reason: 'abaixo_do_piso', storeId: 's1' },
    ]);
    expect(out.accepted).toEqual([
      {
        ean: '789',
        target: 'precoVenda',
        storeId: null,
        price: 12,
        basis: 'margem_minima',
      },
    ]);
  });

  it('oferta NULL da loja NÃO cai na oferta global (teto de variação)', async () => {
    // Global: oferta 2.00 → preço 8 estoura o teto 3x (variacao_excessiva).
    // Loja s1 tem linha com oferta NULL → sem preço atual de oferta → aceito.
    const service = buildService();
    const em = makeEm(
      [{ ...PRODUCT, precoOferta: '2.00' }],
      [{ id: 's1', active: true }],
      [
        {
          ean: '789',
          storeId: 's1',
          price: null,
          cost: null,
          priceOffer: null,
          offerExternalId: '77',
        },
      ],
    );
    const out = await service.preview(em, 'acme', [
      { ean: '789', target: 'precoOferta', price: 8, storeId: 's1' },
      { ean: '789', target: 'precoOferta', price: 8 },
    ]);
    expect(out.rejected).toEqual([
      { ean: '789', reason: 'variacao_excessiva', storeId: null },
    ]);
    expect(out.accepted).toEqual([
      {
        ean: '789',
        target: 'precoOferta',
        storeId: 's1',
        price: 8,
        basis: null,
      },
    ]);
  });

  it('item de loja NUNCA cai no caderno global: sem linha OU sem caderno → sem_caderno', async () => {
    const service = buildService();
    const em = makeEm(
      [PRODUCT],
      [
        { id: 's-sem-linha', active: true },
        { id: 's-sem-caderno', active: true },
      ],
      [
        {
          ean: '789',
          storeId: 's-sem-caderno',
          price: null,
          cost: null,
          priceOffer: null,
          offerExternalId: null,
        },
      ],
    );
    const out = await service.preview(em, 'acme', [
      { ean: '789', target: 'precoOferta', price: 8.4, storeId: 's-sem-linha' },
      {
        ean: '789',
        target: 'precoOferta',
        price: 8.4,
        storeId: 's-sem-caderno',
      },
      { ean: '789', target: 'precoOferta', price: 8.4 }, // global usa o offer_book (55)
    ]);
    expect(out.rejected).toEqual([
      { ean: '789', reason: 'sem_caderno', storeId: 's-sem-linha' },
      { ean: '789', reason: 'sem_caderno', storeId: 's-sem-caderno' },
    ]);
    expect(out.accepted).toEqual([
      {
        ean: '789',
        target: 'precoOferta',
        storeId: null,
        price: 8.4,
        basis: null,
      },
    ]);
  });

  it('duas lojas no MESMO caderno: divergente rejeita caderno_conflitante; igual rejeita caderno_duplicado', async () => {
    const service = buildService();
    const stores = [
      { id: 's-a', active: true },
      { id: 's-b', active: true },
    ];
    const storeItems: StoreItemSeed[] = ['s-a', 's-b'].map((storeId) => ({
      ean: '789',
      storeId,
      price: null,
      cost: null,
      priceOffer: '8.00',
      offerExternalId: '77',
    }));

    const divergent = await service.preview(
      makeEm([PRODUCT], stores, storeItems),
      'acme',
      [
        { ean: '789', target: 'precoOferta', price: 8.4, storeId: 's-a' },
        { ean: '789', target: 'precoOferta', price: 9.0, storeId: 's-b' },
      ],
    );
    expect(divergent.rejected).toEqual([
      { ean: '789', reason: 'caderno_conflitante', storeId: 's-a' },
    ]);
    expect(divergent.accepted).toEqual([
      {
        ean: '789',
        target: 'precoOferta',
        storeId: 's-b',
        price: 9,
        basis: null,
      },
    ]);

    // Mesmo preço: uma escrita só, mas N itens → N desfechos no relatório.
    const equal = await service.preview(
      makeEm([PRODUCT], stores, storeItems),
      'acme',
      [
        { ean: '789', target: 'precoOferta', price: 8.4, storeId: 's-a' },
        { ean: '789', target: 'precoOferta', price: 8.4, storeId: 's-b' },
      ],
    );
    expect(equal.rejected).toEqual([
      { ean: '789', reason: 'caderno_duplicado', storeId: 's-a' },
    ]);
    expect(equal.accepted).toHaveLength(1);
    expect(equal.total).toBe(2);
  });

  it('caderno explícito divergente do vencedor da loja rejeita caderno_nao_cobre_loja', async () => {
    const service = buildService();
    const em = makeEm(
      [PRODUCT],
      [{ id: 's1', active: true }],
      [
        {
          ean: '789',
          storeId: 's1',
          price: null,
          cost: null,
          priceOffer: '8.00',
          offerExternalId: '77',
        },
      ],
    );
    // caderno global (55) ≠ vencedor da loja (77): sem cobertura verificável.
    // Duas chamadas: o mesmo (ean, alvo, loja) seria colapsado pelo dedup.
    const divergente = await service.preview(em, 'acme', [
      {
        ean: '789',
        target: 'precoOferta',
        price: 8.4,
        storeId: 's1',
        cadernoId: 55,
      },
    ]);
    expect(divergente.rejected).toEqual([
      { ean: '789', reason: 'caderno_nao_cobre_loja', storeId: 's1' },
    ]);
    // igual ao vencedor da loja: passa
    const igual = await service.preview(em, 'acme', [
      {
        ean: '789',
        target: 'precoOferta',
        price: 8.4,
        storeId: 's1',
        cadernoId: 77,
      },
    ]);
    expect(igual.accepted).toHaveLength(1);
  });

  it('rejeições estruturais de caderno não disparam o circuit breaker (wouldAbort)', async () => {
    const service = buildService();
    const stores = Array.from({ length: 10 }, (_, i) => ({
      id: `s-${i}`,
      active: true,
    }));
    const storeItems: StoreItemSeed[] = stores.map(({ id }) => ({
      ean: '789',
      storeId: id,
      price: null,
      cost: null,
      priceOffer: '8.00',
      offerExternalId: '77',
    }));
    // 10 lojas → mesmo caderno, mesmo preço: 9 caderno_duplicado + 1 aceito.
    const out = await service.preview(
      makeEm([PRODUCT], stores, storeItems),
      'acme',
      stores.map(({ id }) => ({
        ean: '789',
        target: 'precoOferta' as const,
        price: 8.4,
        storeId: id,
      })),
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.rejected).toHaveLength(9);
    expect(out.wouldAbort).toBe(false);
  });

  it('regra escopada valida o piso SÓ na loja dela (item global usa piso=custo)', async () => {
    // Regra margem 50% restrita à s1: piso 10 (custo global 5). Item global
    // não tem regra participante → piso = custo (5).
    const service = buildService([margemRule({ storeIds: ['s1'] })]);
    const em = makeEm([PRODUCT], [{ id: 's1', active: true }], []);
    const out = await service.preview(em, 'acme', [
      { ean: '789', target: 'precoVenda', price: 8, storeId: 's1' },
      { ean: '789', target: 'precoVenda', price: 8 },
    ]);
    expect(out.rejected).toEqual([
      { ean: '789', reason: 'abaixo_do_piso', storeId: 's1' },
    ]);
    expect(out.accepted).toMatchObject([
      { ean: '789', target: 'precoVenda', storeId: null, price: 8 },
    ]);
  });

  it('rollback preserva o storeId dos itens aplicados', async () => {
    const service = buildService();
    const applied = [
      {
        ean: '789',
        target: 'precoVenda',
        storeId: 's1',
        priceOldSell: '9.00',
        priceOldOffer: null,
        cadernoId: null,
      },
      {
        ean: '790',
        target: 'precoVenda',
        storeId: null,
        priceOldSell: '0',
        priceOldOffer: null,
        cadernoId: null,
      },
    ];
    const em = {
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({ id: 'run-1' }),
        find: jest.fn().mockResolvedValue(applied),
      })),
    } as unknown as EntityManager;
    const applySpy = jest
      .spyOn(service, 'apply')
      .mockResolvedValue({ applyRunId: 'rb-1', accepted: 1, rejected: [] });
    await service.rollback(em, 'acme', 'user-1', 'run-1');
    // storeId propagado; item com priceOld <= 0 filtrado (irreversível).
    expect(applySpy.mock.calls[0][3].items).toEqual([
      {
        ean: '789',
        target: 'precoVenda',
        storeId: 's1',
        price: 9,
        cadernoId: undefined,
      },
    ]);
  });

  it('insertItems alinha os 10 params por linha (store_id na posição certa)', async () => {
    const service = buildService();
    const inserts: unknown[][] = [];
    const baseEm = makeEm(
      [PRODUCT],
      [{ id: 's1', active: true }],
      [
        {
          ean: '789',
          storeId: 's1',
          price: '12.00',
          cost: '6.00',
          priceOffer: null,
          offerExternalId: null,
        },
      ],
    );
    const em = {
      query: jest.fn((sql: string, params: unknown[]) => {
        if (/INSERT INTO pricing_apply_run/.test(sql)) {
          return Promise.resolve([{ id: params?.[0] }]);
        }
        if (/INSERT INTO pricing_apply_item/.test(sql)) {
          inserts.push(params);
          return Promise.resolve([]);
        }
        return (baseEm.query as jest.Mock)(sql, params) as Promise<unknown[]>;
      }),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      })),
    } as unknown as EntityManager;
    await service.apply(em, 'acme', 'u1', {
      idempotencyKey: 'k1',
      mode: 'agora',
      items: [
        { ean: '789', target: 'precoVenda', price: 12, storeId: 's1' },
        { ean: '789', target: 'precoVenda', price: 11 },
      ],
    });
    const p = inserts[0];
    // (apply_run_id, ean, target, store_id, price, caderno_id,
    //  price_old_sell, price_old_offer, rule_id, basis, cost_at_apply)
    expect(p.slice(1, 6)).toEqual(['789', 'precoVenda', 's1', 12, null]);
    expect(p[6]).toBe(12); // price_old_sell da loja (linha s1)
    expect(p.slice(11, 16)).toEqual(['789', 'precoVenda', null, 11, null]);
    expect(p[16]).toBe(10); // price_old_sell global
  });
});
