import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PricingSuggestionsService } from './pricing-suggestions.service';
import type { ClassificationsService } from '../config/classifications.service';
import type { PriceRoundingService } from '../config/price-rounding.service';
import type { ClustersService } from './clusters.service';
import type {
  SuggestionRuleApi,
  SuggestionRulesService,
} from './suggestion-rules.service';

const rule = (over: Partial<SuggestionRuleApi> = {}): SuggestionRuleApi => ({
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

const buildService = (rules: SuggestionRuleApi[]) =>
  new PricingSuggestionsService(
    {
      list: jest.fn().mockResolvedValue(rules),
    } as unknown as SuggestionRulesService,
    {
      loadActiveClusterMembership: jest.fn().mockResolvedValue(new Map()),
    } as unknown as ClustersService,
    {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as PriceRoundingService,
    {
      list: jest.fn().mockResolvedValue([]),
    } as unknown as ClassificationsService,
  );

/** Mock em: tenant, loja (parametrizável), origens vazias e um produto. */
const makeEm = (storeRows: Array<{ id: string }>) =>
  ({
    query: jest.fn((sql: string) => {
      if (/FROM core\.tenant\s+WHERE slug/.test(sql)) {
        return Promise.resolve([{ id: 't-1' }]);
      }
      if (/core\.tenant_store/.test(sql)) return Promise.resolve(storeRows);
      if (/core\.tenant_competitor_origin/.test(sql)) {
        return Promise.resolve([]);
      }
      if (/FROM product p/.test(sql)) {
        return Promise.resolve([
          {
            ean: '789',
            name: 'Produto X',
            supplier: null,
            classificationId: null,
            classification: null,
            book: null,
            cost: '5.00',
            priceForSell: '10.00',
            priceForOffer: null,
            margin: '50',
            averageVariation: null,
            status: null,
          },
        ]);
      }
      return Promise.resolve([]);
    }),
  }) as unknown as EntityManager;

describe('PricingSuggestionsService ?store=', () => {
  it('store não-numérico → 400', async () => {
    const service = buildService([]);
    await expect(
      service.suggestions(makeEm([]), 'acme', {
        store: 'abc',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('store desconhecida/inativa → 400 (nunca cai no global — alimenta o apply)', async () => {
    const service = buildService([]);
    await expect(
      service.suggestions(makeEm([]), 'acme', {
        store: '42',
      }),
    ).rejects.toThrow('store 42 unknown or inactive');
  });

  it('regra escopada NÃO precifica a visão base; participa da loja dela', async () => {
    const STORE_UUID = '11111111-1111-4111-8111-111111111111';
    // Margem 60% > margem atual de 50% (custo 5, venda 10) → gera sugestão.
    const scoped = [rule({ storeIds: [STORE_UUID], minMargin: 60 })];

    const base = await buildService(scoped).suggestions(
      makeEm([{ id: STORE_UUID }]),
      'acme',
      {},
    );
    expect(base.activeRuleCount).toBe(0);
    expect(base.rows[0].result).toEqual({ kind: 'none', reason: 'sem_regra' });

    const perStore = await buildService(scoped).suggestions(
      makeEm([{ id: STORE_UUID }]),
      'acme',
      { store: '42' },
    );
    expect(perStore.activeRuleCount).toBe(1);
    expect(perStore.rows[0].result.kind).toBe('suggestion');
  });
});
