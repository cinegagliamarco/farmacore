import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { CalculationBaseType } from '../../database/enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../database/enums/price-base-source.enum';
import { PricingActionType } from '../../database/enums/pricing-action-type.enum';
import type { PriceRoundingService } from '../config/price-rounding.service';
import {
  CalculationParams,
  normalizeClassification,
  normalizeClassifications,
  OfferBookRulesService,
  PreviewProductInput,
} from './offer-book-rules.service';

const makeService = (
  roundingList: jest.Mock = jest.fn().mockResolvedValue([]),
): { service: OfferBookRulesService; roundingList: jest.Mock } => {
  const priceRounding = {
    list: roundingList,
  } as unknown as PriceRoundingService;
  return { service: new OfferBookRulesService(priceRounding), roundingList };
};

const product = (
  over: Partial<PreviewProductInput> = {},
): PreviewProductInput => ({
  ean: '7890000000001',
  name: 'Produto',
  externalId: '1',
  classificationPath: 'A > B',
  salePrice: 100,
  cost: 50,
  margin: 50,
  offerPrice: null,
  competitorPrices: {},
  ...over,
});

const params = (over: Partial<CalculationParams> = {}): CalculationParams => ({
  calculationBaseType: CalculationBaseType.SALE_PRICE,
  pricingRules: [],
  priceLocks: [],
  ...over,
});

describe('normalizeClassification', () => {
  it('keeps only the first two levels', () => {
    expect(normalizeClassification('A > B > C > D')).toBe('A > B');
    expect(normalizeClassification('A > B')).toBe('A > B');
    expect(normalizeClassification('A')).toBe('A');
    expect(normalizeClassification('')).toBe('');
  });

  it('dedupes after normalizing a list', () => {
    expect(normalizeClassifications(['A > B > C', 'A > B > D'])).toEqual([
      'A > B',
    ]);
    expect(normalizeClassifications([])).toBeUndefined();
    expect(normalizeClassifications(undefined)).toBeUndefined();
  });
});

describe('OfferBookRulesService.calculatePreviews', () => {
  const { service } = makeService();

  it('applies a discount on SALE_PRICE base', () => {
    const [r] = service.calculatePreviews(
      [product()],
      params({
        pricingRules: [
          { actionType: PricingActionType.DISCOUNT, percentageValue: 10 },
        ],
      }),
    );
    expect(r.currentPrice).toBe(100);
    expect(r.actionType).toBe(PricingActionType.DISCOUNT);
    expect(r.finalPrice).toBe(90);
    expect(r.appliedPercentageValue).toBe(10);
    expect(r.currentMargin).toBe(50);
    expect(r.newMargin).toBe(44.44);
    expect(r.priceLockApplied).toBe(false);
    expect(r.skippedPriceExceedsLimit).toBe(false);
  });

  it('skips an increase that would exceed the base sale price', () => {
    const [r] = service.calculatePreviews(
      [product()],
      params({
        pricingRules: [
          { actionType: PricingActionType.INCREASE, percentageValue: 20 },
        ],
      }),
    );
    expect(r.skippedPriceExceedsLimit).toBe(true);
    expect(r.finalPrice).toBe(100);
    expect(r.appliedPercentageValue).toBe(0);
    expect(r.actionType).toBe(PricingActionType.INCREASE);
  });

  it('uses the lowest of competitor + own prices on COMPETITIVE_PRICE base', () => {
    const [r] = service.calculatePreviews(
      [
        product({
          cost: 40,
          competitorPrices: { DROGAL: 80, DROGASIL: 90 },
        }),
      ],
      params({
        calculationBaseType: CalculationBaseType.COMPETITIVE_PRICE,
        priceBaseSources: [
          PriceBaseSource.OWN_PRICE,
          PriceBaseSource.DROGAL,
          PriceBaseSource.DROGASIL,
        ],
        pricingRules: [
          { actionType: PricingActionType.DISCOUNT, percentageValue: 10 },
        ],
      }),
    );
    expect(r.currentPrice).toBe(80);
    expect(r.finalPrice).toBe(72);
    expect(r.skippedNoCompetitorPrice).toBe(false);
  });

  it('marks a product skipped when no competitor price is found', () => {
    const [r] = service.calculatePreviews(
      [product({ cost: 40, competitorPrices: {} })],
      params({
        calculationBaseType: CalculationBaseType.COMPETITIVE_PRICE,
        priceBaseSources: [PriceBaseSource.DROGAL],
      }),
    );
    expect(r.skippedNoCompetitorPrice).toBe(true);
    expect(r.currentPrice).toBe(100);
    expect(r.finalPrice).toBe(100);
    expect(r.currentMargin).toBe(60);
  });

  it('raises the price to the minimum-margin floor when a lock matches', () => {
    const [r] = service.calculatePreviews(
      [product({ cost: 70 })],
      params({
        pricingRules: [
          { actionType: PricingActionType.DISCOUNT, percentageValue: 30 },
        ],
        priceLocks: [{ minMargin: 20 }],
      }),
    );
    expect(r.priceLockApplied).toBe(true);
    expect(r.finalPrice).toBe(87.5);
    expect(r.newMargin).toBe(20);
    expect(r.appliedPercentageValue).toBe(12.5);
  });

  it('applies decimal-bucket rounding to the final price', () => {
    const [r] = service.calculatePreviews(
      [product({ cost: 10 })],
      params({
        pricingRules: [
          { actionType: PricingActionType.DISCOUNT, percentageValue: 10.55 },
        ],
        priceRoundingRules: [
          {
            priceMin: 0,
            priceMax: 1000,
            decimals: [{ from: 0.4, to: 0.49, roundTo: 0.49 }],
          },
        ],
      }),
    );
    expect(r.priceRoundingApplied).toBe(true);
    expect(r.finalPrice).toBe(89.49);
    expect(r.percentageValue).toBe(10.55);
  });

  it('matches rules by normalized classification prefix only', () => {
    const rows = service.calculatePreviews(
      [
        product({ ean: '1', classificationPath: 'A > B > C' }),
        product({ ean: '2', classificationPath: 'X > Y' }),
      ],
      params({
        pricingRules: [
          {
            classifications: ['A > B'],
            actionType: PricingActionType.DISCOUNT,
            percentageValue: 10,
          },
        ],
      }),
    );
    expect(rows[0].finalPrice).toBe(90);
    expect(rows[0].actionType).toBe(PricingActionType.DISCOUNT);
    expect(rows[1].finalPrice).toBe(100);
    expect(rows[1].actionType).toBeNull();
  });

  it('matches a rule only when both price AND margin ranges hit', () => {
    const rule = {
      priceRangeMin: 50,
      priceRangeMax: 150,
      marginRangeMin: 40,
      marginRangeMax: 60,
      actionType: PricingActionType.DISCOUNT,
      percentageValue: 10,
    };
    const [hit] = service.calculatePreviews(
      [product({ margin: 50 })],
      params({ pricingRules: [rule] }),
    );
    expect(hit.actionType).toBe(PricingActionType.DISCOUNT);
    const [miss] = service.calculatePreviews(
      [product({ margin: 90 })],
      params({ pricingRules: [rule] }),
    );
    expect(miss.actionType).toBeNull();
  });

  it('uses the offer price on OFFER_PRICE base, falling back to sale price', () => {
    const [withOffer] = service.calculatePreviews(
      [product({ offerPrice: 80 })],
      params({ calculationBaseType: CalculationBaseType.OFFER_PRICE }),
    );
    expect(withOffer.currentPrice).toBe(80);
    const [noOffer] = service.calculatePreviews(
      [product({ offerPrice: null })],
      params({ calculationBaseType: CalculationBaseType.OFFER_PRICE }),
    );
    expect(noOffer.currentPrice).toBe(100);
  });

  it('ignores inactive rules and locks', () => {
    const [r] = service.calculatePreviews(
      [product()],
      params({
        pricingRules: [
          {
            actionType: PricingActionType.DISCOUNT,
            percentageValue: 10,
            active: false,
          },
        ],
        priceLocks: [{ minMargin: 99, active: false }],
      }),
    );
    expect(r.actionType).toBeNull();
    expect(r.finalPrice).toBe(100);
    expect(r.priceLockApplied).toBe(false);
  });

  it('applies an increase that stays under the sale price', () => {
    const [r] = service.calculatePreviews(
      [product({ cost: 40, competitorPrices: { DROGAL: 50 } })],
      params({
        calculationBaseType: CalculationBaseType.COMPETITIVE_PRICE,
        priceBaseSources: [PriceBaseSource.DROGAL],
        pricingRules: [
          { actionType: PricingActionType.INCREASE, percentageValue: 20 },
        ],
      }),
    );
    expect(r.currentPrice).toBe(50);
    expect(r.finalPrice).toBe(60);
    expect(r.actionType).toBe(PricingActionType.INCREASE);
    expect(r.skippedPriceExceedsLimit).toBe(false);
  });

  it('recomputes appliedPercentageValue after BOTH lock and rounding, against a distinct offer price', () => {
    const [r] = service.calculatePreviews(
      [product({ salePrice: 200, cost: 70, offerPrice: 100 })],
      params({
        calculationBaseType: CalculationBaseType.OFFER_PRICE,
        pricingRules: [
          { actionType: PricingActionType.DISCOUNT, percentageValue: 30 },
        ],
        priceLocks: [{ minMargin: 20 }],
        priceRoundingRules: [
          {
            priceMin: 0,
            priceMax: 1000,
            decimals: [{ from: 0.4, to: 0.59, roundTo: 0.59 }],
          },
        ],
      }),
    );
    expect(r.currentPrice).toBe(100);
    expect(r.priceLockApplied).toBe(true);
    expect(r.priceRoundingApplied).toBe(true);
    expect(r.finalPrice).toBe(87.59);
    // (baseOfferPrice 100 - finalPrice 87.59) / 100 * 100
    expect(r.appliedPercentageValue).toBe(12.41);
  });
});

describe('OfferBookRulesService overlap validation', () => {
  const { service } = makeService();

  it('rejects two unscoped pricing rules', () => {
    expect(() =>
      service.validateNonOverlappingPricingRules([
        { actionType: PricingActionType.DISCOUNT, percentageValue: 5 },
        { actionType: PricingActionType.INCREASE, percentageValue: 5 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('allows pricing rules on disjoint classifications', () => {
    expect(() =>
      service.validateNonOverlappingPricingRules([
        {
          classifications: ['A'],
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
        {
          classifications: ['B'],
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
      ]),
    ).not.toThrow();
  });

  it('rejects locks on overlapping classifications', () => {
    expect(() =>
      service.validateNonOverlappingPriceLocks([
        { classifications: ['A'], minMargin: 10 },
        { classifications: ['A'], minMargin: 20 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects an all-classifications lock coexisting with another', () => {
    expect(() =>
      service.validateNonOverlappingPriceLocks([
        { minMargin: 10 },
        { classifications: ['A'], minMargin: 20 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('allows a single lock', () => {
    expect(() =>
      service.validateNonOverlappingPriceLocks([{ minMargin: 10 }]),
    ).not.toThrow();
  });

  it('rejects price-only rules with overlapping price ranges', () => {
    expect(() =>
      service.validateNonOverlappingPricingRules([
        {
          priceRangeMin: 0,
          priceRangeMax: 100,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
        {
          priceRangeMin: 50,
          priceRangeMax: 150,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects both-range rules when price AND margin both overlap', () => {
    expect(() =>
      service.validateNonOverlappingPricingRules([
        {
          priceRangeMin: 0,
          priceRangeMax: 100,
          marginRangeMin: 0,
          marginRangeMax: 50,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
        {
          priceRangeMin: 50,
          priceRangeMax: 150,
          marginRangeMin: 40,
          marginRangeMax: 90,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('allows both-range rules when only price overlaps but margin does not', () => {
    expect(() =>
      service.validateNonOverlappingPricingRules([
        {
          priceRangeMin: 0,
          priceRangeMax: 100,
          marginRangeMin: 0,
          marginRangeMax: 50,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
        {
          priceRangeMin: 50,
          priceRangeMax: 150,
          marginRangeMin: 60,
          marginRangeMax: 90,
          actionType: PricingActionType.DISCOUNT,
          percentageValue: 5,
        },
      ]),
    ).not.toThrow();
  });
});

const makeEmSpy = (
  handlers: Record<string, unknown>,
): { em: EntityManager; query: jest.Mock } => {
  const query = jest.fn((sql: string) => {
    for (const [fragment, result] of Object.entries(handlers))
      if (sql.includes(fragment)) return Promise.resolve(result);
    return Promise.resolve([]);
  });
  return { em: { query } as unknown as EntityManager, query };
};

const makeEm = (handlers: Record<string, unknown>): EntityManager =>
  makeEmSpy(handlers).em;

describe('OfferBookRulesService.preview', () => {
  it('rejects sending both eans and classifications', async () => {
    const { service } = makeService();
    await expect(
      service.preview(makeEm({}), 'slug', {
        calculationBaseType: CalculationBaseType.SALE_PRICE,
        eans: ['1'],
        classifications: ['A'],
        pricingRules: [],
        priceLocks: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects sending neither eans nor classifications', async () => {
    const { service } = makeService();
    await expect(
      service.preview(makeEm({}), 'slug', {
        calculationBaseType: CalculationBaseType.SALE_PRICE,
        pricingRules: [],
        priceLocks: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires priceBaseSources for COMPETITIVE_PRICE', async () => {
    const { service } = makeService();
    await expect(
      service.preview(makeEm({}), 'slug', {
        calculationBaseType: CalculationBaseType.COMPETITIVE_PRICE,
        eans: ['1'],
        pricingRules: [],
        priceLocks: [],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('paginates and runs the engine over fetched products', async () => {
    const { service, roundingList } = makeService();
    const em = makeEm({
      'count(*)::int': [{ count: 1 }],
      'p.ean AS ean': [
        {
          ean: '7890000000001',
          name: 'Dipirona',
          externalId: '10',
          price: '100.00',
          cost: '50.0000',
          margin: '50.0000',
          classification: 'A > B',
          offerPrice: null,
        },
      ],
    });
    const result = await service.preview(em, 'slug', {
      calculationBaseType: CalculationBaseType.SALE_PRICE,
      eans: ['7890000000001'],
      pricingRules: [
        { actionType: PricingActionType.DISCOUNT, percentageValue: 10 },
      ],
      priceLocks: [],
    });
    expect(result.total).toBe(1);
    expect(result.totalPages).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].finalPrice).toBe(90);
    expect(roundingList).not.toHaveBeenCalled();
  });

  it('crosses competitor prices on COMPETITIVE_PRICE', async () => {
    const { service } = makeService();
    const em = makeEm({
      'count(*)::int': [{ count: 1 }],
      'p.ean AS ean': [
        {
          ean: '7890000000001',
          name: 'Dipirona',
          externalId: '10',
          price: '100.00',
          cost: '40.0000',
          margin: '60.0000',
          classification: 'A > B',
          offerPrice: null,
        },
      ],
      'shared_catalog.product': [
        { ean: '7890000000001', origin: 'DROGAL', price: '80.00' },
      ],
    });
    const result = await service.preview(em, 'slug', {
      calculationBaseType: CalculationBaseType.COMPETITIVE_PRICE,
      priceBaseSources: [PriceBaseSource.DROGAL],
      eans: ['7890000000001'],
      pricingRules: [],
      priceLocks: [],
    });
    expect(result.rows[0].currentPrice).toBe(80);
  });

  it('loads rounding rules when applyPriceRounding is set', async () => {
    const roundingList = jest.fn().mockResolvedValue([
      {
        id: 'r1',
        priceMin: 0,
        priceMax: 1000,
        rules: [{ decimalMin: 0.4, decimalMax: 0.49, roundTo: 0.49 }],
      },
    ]);
    const { service } = makeService(roundingList);
    const em = makeEm({
      'count(*)::int': [{ count: 1 }],
      'p.ean AS ean': [
        {
          ean: '7890000000001',
          name: 'Dipirona',
          externalId: '10',
          price: '100.00',
          cost: '10.0000',
          margin: '90.0000',
          classification: 'A > B',
          offerPrice: null,
        },
      ],
    });
    const result = await service.preview(em, 'slug', {
      calculationBaseType: CalculationBaseType.SALE_PRICE,
      eans: ['7890000000001'],
      applyPriceRounding: true,
      pricingRules: [
        { actionType: PricingActionType.DISCOUNT, percentageValue: 10.55 },
      ],
      priceLocks: [],
    });
    expect(roundingList).toHaveBeenCalledWith(em, 'slug');
    expect(result.rows[0].priceRoundingApplied).toBe(true);
    expect(result.rows[0].finalPrice).toBe(89.49);
  });

  it('queries the classifications branch with starts_with and correctly indexed params', async () => {
    const { service } = makeService();
    const { em, query } = makeEmSpy({
      'count(*)::int': [{ count: 1 }],
      'p.ean AS ean': [
        {
          ean: '7890000000001',
          name: 'Dipirona',
          externalId: null,
          price: '100.00',
          cost: '50.0000',
          margin: '50.0000',
          classification: 'A > B',
          offerPrice: null,
        },
      ],
    });
    const result = await service.preview(em, 'slug', {
      calculationBaseType: CalculationBaseType.SALE_PRICE,
      classifications: ['A > B', 'C'],
      pricingRules: [],
      priceLocks: [],
      page: 2,
      pageSize: 10,
    });
    expect(result.rows).toHaveLength(1);
    const pageCall = query.mock.calls.find(([sql]: [string]) =>
      sql.includes('p.ean AS ean'),
    );
    expect(pageCall[0]).toContain("starts_with(cls.path, $1 || ' > ')");
    expect(pageCall[0]).toContain("starts_with(cls.path, $2 || ' > ')");
    // 2 classification params, then LIMIT pageSize=10, OFFSET (2-1)*10=10
    expect(pageCall[1]).toEqual(['A > B', 'C', 10, 10]);
  });

  it('returns an empty page when no products match', async () => {
    const { service } = makeService();
    const em = makeEm({ 'count(*)::int': [{ count: 0 }] });
    const result = await service.preview(em, 'slug', {
      calculationBaseType: CalculationBaseType.SALE_PRICE,
      eans: ['7890000000001'],
      pricingRules: [],
      priceLocks: [],
    });
    expect(result).toEqual({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 1000,
      totalPages: 0,
    });
  });
});
