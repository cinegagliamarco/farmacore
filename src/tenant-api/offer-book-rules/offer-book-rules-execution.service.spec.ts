import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import type { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { PreviewProductResult } from './dto/preview-offer-book-rules.dto';
import { OfferBookRulesExecutionService } from './offer-book-rules-execution.service';
import type {
  OfferBookRuleDetail,
  OfferBookRulesManagementService,
} from './offer-book-rules-management.service';

const row = (
  over: Partial<PreviewProductResult> = {},
): PreviewProductResult => ({
  ean: '7890000000001',
  name: 'Produto',
  externalId: '5001',
  classification: 'A > B',
  baseSalePrice: 10,
  baseOfferPrice: 10,
  currentPrice: 10,
  currentMargin: 50,
  cost: 5,
  actionType: null,
  percentageValue: 0,
  appliedPercentageValue: 0,
  finalPrice: 9, // != currentPrice → updatable by default
  newMargin: 44.44,
  priceLockApplied: false,
  discountSkipped: false,
  skippedNoCompetitorPrice: false,
  skippedPriceExceedsLimit: false,
  priceRoundingApplied: false,
  ...over,
});

/** em.query dispatcher: the report INSERT returns an id, everything else []. */
const makeEm = (): { em: EntityManager; query: jest.Mock } => {
  const query = jest.fn((sql: string) =>
    Promise.resolve(sql.includes('RETURNING id') ? [{ id: 'report-1' }] : []),
  );
  return { em: { query } as unknown as EntityManager, query };
};

const RULE: OfferBookRuleDetail = {
  id: 'rule-1',
  name: 'r',
  description: null,
  calculationBaseType: 'SALE_PRICE' as never,
  priceBaseSources: null,
  eans: ['7890000000001'],
  classifications: null,
  applyPriceRounding: false,
  enabled: true,
  cadernoId: '777',
  pricingRules: [],
  priceLocks: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const make = (opts: {
  rows: PreviewProductResult[];
  cadernoId?: string | null;
  creds?: unknown;
  upsert?: jest.Mock;
}) => {
  const { em, query } = makeEm();
  const previewSaved = jest
    .fn()
    .mockImplementation((_em, _slug, _id, page: number) =>
      Promise.resolve(
        page === 1
          ? { rows: opts.rows, count: opts.rows.length, page: 1, perPage: 1000 }
          : { rows: [], count: opts.rows.length, page, perPage: 1000 },
      ),
    );
  const mgmt = {
    getById: jest.fn().mockResolvedValue({
      ...RULE,
      cadernoId: opts.cadernoId === undefined ? '777' : opts.cadernoId,
    }),
    previewSaved,
  } as unknown as OfferBookRulesManagementService;
  const integration = {
    getApiCredentials: jest
      .fn()
      .mockResolvedValue(
        opts.creds === undefined ? { baseUrl: 'x', apiKey: 'y' } : opts.creds,
      ),
  } as unknown as IntegrationConnectionService;
  const upsertOffer = opts.upsert ?? jest.fn().mockResolvedValue(undefined);
  const a7 = { upsertOffer } as unknown as A7PharmaApiClient;
  const service = new OfferBookRulesExecutionService(mgmt, integration, a7);
  return { service, em, query, upsertOffer };
};

describe('OfferBookRulesExecutionService.execute', () => {
  it('pushes the updatable products and reports SUCCESS', async () => {
    const { service, em, upsertOffer } = make({
      rows: [
        row({ ean: '1', externalId: '5001', finalPrice: 9 }),
        row({ ean: '2', externalId: '5002', finalPrice: 7.2 }),
      ],
    });
    const res = await service.execute(em, 'slug', 'rule-1');
    expect(res.outcome).toBe('SUCCESS');
    expect(res.totalProducts).toBe(2);
    expect(res.productsUpdated).toBe(2);
    expect(res.productsSkipped).toBe(0);
    expect(upsertOffer).toHaveBeenCalledTimes(1);
    expect(upsertOffer).toHaveBeenCalledWith(
      { baseUrl: 'x', apiKey: 'y' },
      777,
      [
        { idEmbalagem: 5001, precoOferta: 9 },
        { idEmbalagem: 5002, precoOferta: 7.2 },
      ],
    );
  });

  it('skips no-op, skipped-flag, and externalId-less products', async () => {
    const { service, em, upsertOffer } = make({
      rows: [
        row({ ean: '1', finalPrice: 9 }), // updatable
        row({ ean: '2', finalPrice: 10, currentPrice: 10 }), // no-op → skip
        row({ ean: '3', skippedNoCompetitorPrice: true }), // skipped → skip
        row({ ean: '4', externalId: null }), // no ERP id → skip
      ],
    });
    const res = await service.execute(em, 'slug', 'rule-1');
    expect(res.outcome).toBe('SUCCESS');
    expect(res.productsUpdated).toBe(1);
    expect(res.productsSkipped).toBe(3);
    expect(upsertOffer).toHaveBeenCalledTimes(1);
    expect(upsertOffer.mock.calls[0][2]).toHaveLength(1);
  });

  it('reports NO_CHANGES and never calls the ERP when nothing is updatable', async () => {
    const { service, em, upsertOffer } = make({
      rows: [
        row({ ean: '1', finalPrice: 10, currentPrice: 10 }),
        row({ ean: '2', skippedPriceExceedsLimit: true }),
      ],
    });
    const res = await service.execute(em, 'slug', 'rule-1');
    expect(res.outcome).toBe('NO_CHANGES');
    expect(res.productsUpdated).toBe(0);
    expect(res.productsSkipped).toBe(2);
    expect(upsertOffer).not.toHaveBeenCalled();
  });

  it('reports FAILURE (and records the error) when the only batch fails', async () => {
    const upsert = jest.fn().mockRejectedValue(new Error('ERP 503'));
    const { service, em, query } = make({
      rows: [row({ ean: '1', finalPrice: 9 })],
      upsert,
    });
    const res = await service.execute(em, 'slug', 'rule-1');
    expect(res.outcome).toBe('FAILURE');
    expect(res.productsUpdated).toBe(0);
    const finalize = query.mock.calls.find(([sql]: [string]) =>
      sql.includes('SET finished_at'),
    );
    expect(String(finalize[1][2])).toContain('ERP 503'); // error_message param
  });

  it('reports PARTIALLY_SUCCEEDED when one of several batches fails', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'));
    const rows = Array.from({ length: 81 }, (_, i) =>
      row({ ean: String(i), externalId: String(5000 + i), finalPrice: 9 }),
    );
    const { service, em } = make({ rows, upsert });
    const res = await service.execute(em, 'slug', 'rule-1');
    expect(res.outcome).toBe('PARTIALLY_SUCCEEDED');
    expect(res.productsUpdated).toBe(80); // first batch only
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('rejects a rule with no caderno', async () => {
    const { service, em } = make({ rows: [], cadernoId: null });
    await expect(service.execute(em, 'slug', 'rule-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects when the tenant has no ERP credentials', async () => {
    const { service, em } = make({ rows: [], creds: null });
    await expect(service.execute(em, 'slug', 'rule-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
