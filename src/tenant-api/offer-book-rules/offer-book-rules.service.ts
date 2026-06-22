import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CalculationBaseType } from '../../database/enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../database/enums/price-base-source.enum';
import { PricingActionType } from '../../database/enums/pricing-action-type.enum';
import { PriceRoundingService } from '../config/price-rounding.service';
import {
  CreatePriceLockDto,
  CreatePricingRuleDto,
  PaginatedPreviewResult,
  PreviewOfferBookRulesDto,
  PreviewProductResult,
} from './dto/preview-offer-book-rules.dto';

/**
 * Normalizes a classification path to its first two levels — the level at
 * which rules and locks match. "A > B > C" → "A > B"; "A" stays "A".
 */
export function normalizeClassification(classification: string): string {
  if (!classification) return classification;
  const parts = classification.split(' > ');
  return parts.length <= 2 ? classification : `${parts[0]} > ${parts[1]}`;
}

export function normalizeClassifications(
  classifications?: string[] | null,
): string[] | undefined {
  if (!classifications || classifications.length === 0) return undefined;
  return [...new Set(classifications.map(normalizeClassification))];
}

/** A product fed to the calculation engine — DB-agnostic plain data. */
export interface PreviewProductInput {
  ean: string;
  name: string;
  externalId: string | null;
  classificationPath: string;
  salePrice: number;
  cost: number;
  margin: number;
  offerPrice: number | null;
  competitorPrices: Partial<Record<PriceBaseSource, number>>;
}

/** A price band with its decimal-bucket rounding buckets. */
export interface PriceRoundingRuleInput {
  priceMin: number;
  priceMax: number;
  decimals: { from: number; to: number; roundTo: number }[];
}

export interface CalculationParams {
  calculationBaseType: CalculationBaseType;
  priceBaseSources?: PriceBaseSource[];
  pricingRules: CreatePricingRuleDto[];
  priceLocks: CreatePriceLockDto[];
  priceRoundingRules?: PriceRoundingRuleInput[];
}

const MAX_PAGE_SIZE = 1000;

/**
 * Offer-book-rules pricing engine (port of the legacy service). The pure
 * methods (normalize/validate/calculate) carry the same math as the legacy
 * `OfferBookRulesService`; `preview` is the tenant-scoped orchestration that
 * feeds them from the new schema (tenant `product` + `classification` tree +
 * `offer_book`, shared `shared_catalog.product`, and `core` rounding).
 */
@Injectable()
export class OfferBookRulesService {
  constructor(private readonly priceRounding: PriceRoundingService) {}

  public async preview(
    em: EntityManager,
    slug: string,
    dto: PreviewOfferBookRulesDto,
  ): Promise<PaginatedPreviewResult> {
    const byEans = !!dto.eans?.length;
    const byClassifications = !!dto.classifications?.length;
    if (byEans === byClassifications)
      throw new BadRequestException(
        'Send either a list of eans or a list of classifications, but not both',
      );
    if (
      dto.calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE &&
      !dto.priceBaseSources?.length
    )
      throw new BadRequestException(
        'priceBaseSources must contain at least one source when calculationBaseType is COMPETITIVE_PRICE',
      );

    const page = dto.page ?? 1;
    const pageSize = Math.min(dto.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);

    const pricingRules = this.normalizePricingRules(dto.pricingRules);
    const priceLocks = this.normalizePriceLocks(dto.priceLocks);
    this.validateNonOverlappingPricingRules(pricingRules);
    this.validateNonOverlappingPriceLocks(priceLocks);

    const { total, products } = await this.fetchProducts(
      em,
      dto,
      page,
      pageSize,
    );
    if (total === 0)
      return { rows: [], total: 0, page, pageSize, totalPages: 0 };

    if (dto.calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE)
      await this.attachCompetitorPrices(em, products, dto.priceBaseSources!);

    const priceRoundingRules = dto.applyPriceRounding
      ? await this.fetchRoundingRules(em, slug)
      : [];

    const rows = this.calculatePreviews(products, {
      calculationBaseType: dto.calculationBaseType,
      priceBaseSources: dto.priceBaseSources,
      pricingRules,
      priceLocks,
      priceRoundingRules,
    });

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  public normalizePricingRules(
    pricingRules: CreatePricingRuleDto[],
  ): CreatePricingRuleDto[] {
    return pricingRules.map((rule) => ({
      ...rule,
      classifications: normalizeClassifications(rule.classifications),
    }));
  }

  public normalizePriceLocks(
    priceLocks: CreatePriceLockDto[],
  ): CreatePriceLockDto[] {
    return priceLocks.map((lock) => ({
      ...lock,
      classifications: normalizeClassifications(lock.classifications),
    }));
  }

  public validateNonOverlappingPriceLocks(
    priceLocks: CreatePriceLockDto[],
  ): void {
    const activeLocks = priceLocks.filter((lock) => lock.active !== false);
    if (activeLocks.length === 0) return;

    const allClassificationsLocks = activeLocks.filter(
      (lock) => !lock.classifications || lock.classifications.length === 0,
    );
    if (allClassificationsLocks.length > 0 && activeLocks.length > 1)
      throw new BadRequestException(
        'Price lock targeting all classifications cannot coexist with other price locks. ' +
          'Remove the "all classifications" lock or remove all other locks.',
      );

    for (let i = 0; i < activeLocks.length; i++) {
      for (let j = i + 1; j < activeLocks.length; j++) {
        if (
          this.classificationsOverlap(
            activeLocks[i].classifications,
            activeLocks[j].classifications,
          )
        )
          throw new BadRequestException(
            `Price locks overlap: Lock ${i + 1} and Lock ${j + 1} target overlapping classifications. ` +
              'Ensure each classification is only targeted by one price lock.',
          );
      }
    }
  }

  public validateNonOverlappingPricingRules(
    pricingRules: CreatePricingRuleDto[],
  ): void {
    const activeRules = pricingRules.filter((rule) => rule.active !== false);
    for (let i = 0; i < activeRules.length; i++) {
      for (let j = i + 1; j < activeRules.length; j++) {
        if (this.rulesOverlap(activeRules[i], activeRules[j]))
          throw new BadRequestException(
            `Pricing rules overlap: Rule ${i + 1} and Rule ${j + 1} can target the same products. ` +
              'Ensure classifications and price/margin ranges do not overlap.',
          );
      }
    }
  }

  public calculatePreviews(
    products: PreviewProductInput[],
    params: CalculationParams,
  ): PreviewProductResult[] {
    return products.map((product) =>
      this.calculateProductPreview(product, params),
    );
  }

  private calculateProductPreview(
    product: PreviewProductInput,
    params: CalculationParams,
  ): PreviewProductResult {
    const currentPrice = this.getCalculationBasePrice(
      product,
      params.calculationBaseType,
      params.priceBaseSources,
    );

    const cost = product.cost;
    const basePrice = product.offerPrice || product.salePrice;
    const currentMargin =
      basePrice > 0 ? ((basePrice - cost) / basePrice) * 100 : 0;
    const baseSalePrice = product.salePrice;
    const classification = normalizeClassification(product.classificationPath);
    const baseOfferPrice = product.offerPrice ?? baseSalePrice;

    // COMPETITIVE_PRICE with no competitor price found — skip, keep current state.
    if (currentPrice === null) {
      const productCurrentMargin =
        cost > 0 && baseSalePrice > 0
          ? ((baseSalePrice - cost) / baseSalePrice) * 100
          : 0;
      return {
        ean: product.ean,
        name: product.name,
        externalId: product.externalId,
        classification,
        baseSalePrice,
        baseOfferPrice,
        currentPrice: baseSalePrice,
        currentMargin: round2(productCurrentMargin),
        cost,
        actionType: null,
        percentageValue: 0,
        appliedPercentageValue: 0,
        finalPrice: baseSalePrice,
        newMargin: round2(productCurrentMargin),
        priceLockApplied: false,
        discountSkipped: false,
        skippedNoCompetitorPrice: true,
        skippedPriceExceedsLimit: false,
        priceRoundingApplied: false,
      };
    }

    const matchingRule = this.findMatchingPricingRule(
      product,
      params.pricingRules,
      currentPrice,
    );
    const matchingPriceLock = this.findMatchingPriceLock(
      product,
      params.priceLocks,
    );

    let actionType: PricingActionType | null = null;
    let percentageValue = 0;
    let finalPrice = currentPrice;
    let priceLockApplied = false;

    if (matchingRule) {
      actionType = matchingRule.actionType;
      percentageValue = matchingRule.percentageValue;
      finalPrice =
        actionType === PricingActionType.DISCOUNT
          ? currentPrice * (1 - percentageValue / 100)
          : currentPrice * (1 + percentageValue / 100);
    }

    // An increase must never push the price above the base sale price.
    if (finalPrice > baseSalePrice && baseSalePrice > 0) {
      return {
        ean: product.ean,
        name: product.name,
        externalId: product.externalId,
        classification,
        baseSalePrice,
        baseOfferPrice,
        currentPrice,
        currentMargin: round2(currentMargin),
        cost,
        actionType: matchingRule?.actionType ?? null,
        percentageValue: matchingRule?.percentageValue ?? 0,
        appliedPercentageValue: 0,
        finalPrice: currentPrice,
        newMargin: round2(currentMargin),
        priceLockApplied: false,
        discountSkipped: false,
        skippedNoCompetitorPrice: false,
        skippedPriceExceedsLimit: true,
        priceRoundingApplied: false,
      };
    }

    let newMargin = cost > 0 ? ((finalPrice - cost) / finalPrice) * 100 : 0;
    const priceAfterRule = finalPrice;

    // Price lock: bump the price to the minimum-margin floor when current or
    // new margin falls below it.
    if (
      matchingPriceLock &&
      (currentMargin < matchingPriceLock.minMargin ||
        newMargin < matchingPriceLock.minMargin)
    ) {
      const minMarginDecimal = matchingPriceLock.minMargin / 100;
      if (minMarginDecimal < 1 && cost > 0) {
        finalPrice = cost / (1 - minMarginDecimal);
        newMargin = matchingPriceLock.minMargin;
        priceLockApplied = true;
      }
    }

    let appliedPercentageValue = percentageValue;
    if (priceLockApplied && finalPrice !== priceAfterRule && baseOfferPrice > 0)
      appliedPercentageValue = this.effectivePercentage(
        actionType,
        finalPrice,
        baseOfferPrice,
      );

    let priceRoundingApplied = false;
    const roundingResult = this.applyPriceRounding(
      finalPrice,
      params.priceRoundingRules,
    );
    if (roundingResult !== null) {
      finalPrice = roundingResult;
      priceRoundingApplied = true;
      newMargin = cost > 0 ? ((finalPrice - cost) / finalPrice) * 100 : 0;
      if (priceLockApplied && baseOfferPrice > 0)
        appliedPercentageValue = this.effectivePercentage(
          actionType,
          finalPrice,
          baseOfferPrice,
        );
    }

    return {
      ean: product.ean,
      name: product.name,
      externalId: product.externalId,
      classification,
      baseSalePrice,
      baseOfferPrice,
      currentPrice,
      currentMargin: round2(currentMargin),
      cost,
      actionType,
      percentageValue,
      appliedPercentageValue: round2(appliedPercentageValue),
      finalPrice: round2(finalPrice),
      newMargin: round2(newMargin),
      priceLockApplied,
      discountSkipped: false,
      skippedNoCompetitorPrice: false,
      skippedPriceExceedsLimit: false,
      priceRoundingApplied,
    };
  }

  /** Effective percentage after a lock/rounding moved the price off the rule's. */
  private effectivePercentage(
    actionType: PricingActionType | null,
    finalPrice: number,
    baseOfferPrice: number,
  ): number {
    return actionType === PricingActionType.DISCOUNT
      ? ((baseOfferPrice - finalPrice) / baseOfferPrice) * 100
      : ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100;
  }

  private getCalculationBasePrice(
    product: PreviewProductInput,
    calculationBaseType: CalculationBaseType,
    priceBaseSources?: PriceBaseSource[],
  ): number | null {
    switch (calculationBaseType) {
      case CalculationBaseType.SALE_PRICE:
        return product.salePrice;
      case CalculationBaseType.OFFER_PRICE:
        return product.offerPrice ?? product.salePrice;
      case CalculationBaseType.COMPETITIVE_PRICE:
        return this.getLowestPriceFromSources(product, priceBaseSources);
      default:
        return product.salePrice;
    }
  }

  private getLowestPriceFromSources(
    product: PreviewProductInput,
    priceBaseSources?: PriceBaseSource[],
  ): number | null {
    if (!priceBaseSources || priceBaseSources.length === 0) return null;

    const prices: number[] = [];
    for (const source of priceBaseSources) {
      if (source === PriceBaseSource.OWN_PRICE) {
        const ownPrice = product.offerPrice ?? product.salePrice;
        if (ownPrice && ownPrice > 0) prices.push(ownPrice);
      } else {
        const price = product.competitorPrices[source];
        if (price && price > 0) prices.push(price);
      }
    }
    return prices.length === 0 ? null : Math.min(...prices);
  }

  private findMatchingPricingRule(
    product: PreviewProductInput,
    pricingRules: CreatePricingRuleDto[],
    currentPrice: number,
  ): CreatePricingRuleDto | null {
    const classification = normalizeClassification(product.classificationPath);
    const margin = product.margin;

    for (const rule of pricingRules) {
      if (rule.active === false) continue;
      if (!this.classificationMatches(classification, rule.classifications))
        continue;

      const priceRangeMatches = this.rangeMatches(
        currentPrice,
        rule.priceRangeMin,
        rule.priceRangeMax,
      );
      const marginRangeMatches = this.rangeMatches(
        margin,
        rule.marginRangeMin,
        rule.marginRangeMax,
      );
      const hasPriceRange =
        rule.priceRangeMin !== undefined || rule.priceRangeMax !== undefined;
      const hasMarginRange =
        rule.marginRangeMin !== undefined || rule.marginRangeMax !== undefined;

      if (hasPriceRange && hasMarginRange) {
        if (priceRangeMatches && marginRangeMatches) return rule;
      } else if (hasPriceRange) {
        if (priceRangeMatches) return rule;
      } else if (hasMarginRange) {
        if (marginRangeMatches) return rule;
      } else {
        return rule;
      }
    }
    return null;
  }

  private findMatchingPriceLock(
    product: PreviewProductInput,
    priceLocks: CreatePriceLockDto[],
  ): CreatePriceLockDto | null {
    const classification = normalizeClassification(product.classificationPath);
    for (const lock of priceLocks) {
      if (lock.active === false) continue;
      if (this.classificationMatches(classification, lock.classifications))
        return lock;
    }
    return null;
  }

  private applyPriceRounding(
    price: number,
    rules?: PriceRoundingRuleInput[],
  ): number | null {
    if (!rules || rules.length === 0) return null;

    const matchingRule = rules.find(
      (rule) => price >= rule.priceMin && price <= rule.priceMax,
    );
    if (!matchingRule || matchingRule.decimals.length === 0) return null;

    const integerPart = Math.floor(price);
    const decimalPart = round2(price - integerPart);
    const bucket = matchingRule.decimals.find(
      (d) => decimalPart >= d.from && decimalPart <= d.to,
    );
    if (!bucket) return null;

    const roundedPrice = integerPart + bucket.roundTo;
    if (roundedPrice === round2(price)) return null;
    return round2(roundedPrice);
  }

  private classificationMatches(
    classification: string,
    classifications?: string[],
  ): boolean {
    if (!classifications || classifications.length === 0) return true;
    return classifications.some((filter) => classification.startsWith(filter));
  }

  private rangeMatches(value: number, min?: number, max?: number): boolean {
    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;
    return true;
  }

  private rulesOverlap(
    ruleA: CreatePricingRuleDto,
    ruleB: CreatePricingRuleDto,
  ): boolean {
    if (
      !this.classificationsOverlap(ruleA.classifications, ruleB.classifications)
    )
      return false;

    const aPrice =
      ruleA.priceRangeMin !== undefined || ruleA.priceRangeMax !== undefined;
    const aMargin =
      ruleA.marginRangeMin !== undefined || ruleA.marginRangeMax !== undefined;
    const bPrice =
      ruleB.priceRangeMin !== undefined || ruleB.priceRangeMax !== undefined;
    const bMargin =
      ruleB.marginRangeMin !== undefined || ruleB.marginRangeMax !== undefined;

    // A rule with no range filters applies to every product in its classification.
    if (!aPrice && !aMargin) return true;
    if (!bPrice && !bMargin) return true;

    const priceRangesOverlap =
      (aPrice || bPrice) &&
      this.rangesOverlap(
        aPrice ? ruleA.priceRangeMin : undefined,
        aPrice ? ruleA.priceRangeMax : undefined,
        bPrice ? ruleB.priceRangeMin : undefined,
        bPrice ? ruleB.priceRangeMax : undefined,
      );
    const marginRangesOverlap =
      (aMargin || bMargin) &&
      this.rangesOverlap(
        aMargin ? ruleA.marginRangeMin : undefined,
        aMargin ? ruleA.marginRangeMax : undefined,
        bMargin ? ruleB.marginRangeMin : undefined,
        bMargin ? ruleB.marginRangeMax : undefined,
      );

    const aBoth = aPrice && aMargin;
    const bBoth = bPrice && bMargin;

    if (aBoth && bBoth) return priceRangesOverlap && marginRangesOverlap;
    if (aBoth) {
      if (bPrice && !bMargin) return priceRangesOverlap;
      if (bMargin && !bPrice) return marginRangesOverlap;
    }
    if (bBoth) {
      if (aPrice && !aMargin) return priceRangesOverlap;
      if (aMargin && !aPrice) return marginRangesOverlap;
    }

    const aOnlyPrice = aPrice && !aMargin;
    const aOnlyMargin = !aPrice && aMargin;
    const bOnlyPrice = bPrice && !bMargin;
    const bOnlyMargin = !bPrice && bMargin;

    if (aOnlyPrice && bOnlyPrice) return priceRangesOverlap;
    if (aOnlyMargin && bOnlyMargin) return marginRangesOverlap;
    // One filters by price only, the other by margin only — a product could match both.
    if ((aOnlyPrice && bOnlyMargin) || (aOnlyMargin && bOnlyPrice)) return true;

    return false;
  }

  private classificationsOverlap(
    classificationsA?: string[],
    classificationsB?: string[],
  ): boolean {
    // Null/empty means "all classifications" — overlaps with anything.
    if (!classificationsA || classificationsA.length === 0) return true;
    if (!classificationsB || classificationsB.length === 0) return true;
    return classificationsA.some((a) =>
      classificationsB.some((b) => a.startsWith(b) || b.startsWith(a)),
    );
  }

  private rangesOverlap(
    minA?: number,
    maxA?: number,
    minB?: number,
    maxB?: number,
  ): boolean {
    const effMinA = minA ?? -Infinity;
    const effMaxA = maxA ?? Infinity;
    const effMinB = minB ?? -Infinity;
    const effMaxB = maxB ?? Infinity;
    return effMinA <= effMaxB && effMinB <= effMaxA;
  }

  private async fetchProducts(
    em: EntityManager,
    dto: PreviewOfferBookRulesDto,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; products: PreviewProductInput[] }> {
    const joins = `FROM product p
       LEFT JOIN cls ON cls.id = p.classification_id
       LEFT JOIN offer_book ob ON ob.ean = p.ean`;

    let where: string;
    let params: unknown[];
    if (dto.eans?.length) {
      where =
        'WHERE p.active = true AND p.deleted_at IS NULL AND p.ean = ANY($1::bigint[])';
      params = [dto.eans];
    } else {
      const conds = dto
        .classifications!.map(
          (_c, i) =>
            `(cls.path = $${i + 1} OR cls.path LIKE $${i + 1} || ' > %')`,
        )
        .join(' OR ');
      where = `WHERE p.active = true AND p.deleted_at IS NULL AND (${conds})`;
      params = [...dto.classifications!];
    }

    const countRows: Array<{ count: number }> = await em.query(
      `${CLS_CTE} SELECT count(*)::int AS count ${joins} ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;
    if (total === 0) return { total: 0, products: [] };

    const rows: Array<Record<string, unknown>> = await em.query(
      `${CLS_CTE}
       SELECT p.ean AS ean, p.name AS name, p.external_id AS "externalId",
              p.price AS price, p.cost AS cost, p.margin AS margin,
              COALESCE(cls.path, '') AS classification,
              ob.target_price AS "offerPrice"
       ${joins} ${where}
       ORDER BY p.ean ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    return { total, products: rows.map(toPreviewProduct) };
  }

  private async attachCompetitorPrices(
    em: EntityManager,
    products: PreviewProductInput[],
    priceBaseSources: PriceBaseSource[],
  ): Promise<void> {
    const origins = priceBaseSources.filter(
      (s) => s !== PriceBaseSource.OWN_PRICE,
    );
    if (origins.length === 0) return;

    const rows: Array<{ ean: string; origin: string; price: string }> =
      await em.query(
        `SELECT ean, origin, price
           FROM shared_catalog.product
          WHERE ean = ANY($1::bigint[]) AND origin = ANY($2)
            AND price IS NOT NULL AND deleted_at IS NULL`,
        [products.map((p) => p.ean), origins],
      );

    const byEan = new Map<string, Partial<Record<PriceBaseSource, number>>>();
    for (const r of rows) {
      const ean = String(r.ean);
      const map = byEan.get(ean) ?? {};
      map[r.origin as PriceBaseSource] = Number(r.price);
      byEan.set(ean, map);
    }
    for (const product of products)
      product.competitorPrices = byEan.get(product.ean) ?? {};
  }

  private async fetchRoundingRules(
    em: EntityManager,
    slug: string,
  ): Promise<PriceRoundingRuleInput[]> {
    const ranges = await this.priceRounding.list(em, slug);
    return ranges.map((range) => ({
      priceMin: range.priceMin,
      priceMax: range.priceMax,
      decimals: range.rules.map((r) => ({
        from: r.decimalMin,
        to: r.decimalMax,
        roundTo: r.roundTo,
      })),
    }));
  }
}

/**
 * Classification breadcrumb CTE. The new schema stores each segment as its
 * own (name, parent_id) row; rules match on the legacy ">"-joined path, so
 * rebuild it top-down.
 */
const CLS_CTE = `WITH RECURSIVE cls AS (
  SELECT id, name::text AS path
    FROM classification
   WHERE parent_id IS NULL AND deleted_at IS NULL
  UNION ALL
  SELECT c.id, cls.path || ' > ' || c.name
    FROM classification c
    JOIN cls ON c.parent_id = cls.id
   WHERE c.deleted_at IS NULL
)`;

function toPreviewProduct(r: Record<string, unknown>): PreviewProductInput {
  return {
    ean: String(r.ean),
    name: (r.name as string | null) ?? '',
    externalId: (r.externalId as string | null) ?? null,
    classificationPath: (r.classification as string | null) ?? '',
    salePrice: num(r.price),
    cost: num(r.cost),
    margin: num(r.margin),
    offerPrice: r.offerPrice == null ? null : Number(r.offerPrice),
    competitorPrices: {},
  };
}

/** Coerce a pg numeric (string|null) to a finite number, defaulting to 0. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
