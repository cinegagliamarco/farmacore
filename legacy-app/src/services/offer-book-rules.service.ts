import { BadRequestException, Injectable } from '@nestjs/common';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { normalizeClassification, normalizeClassifications } from '../common/normalize-classification.helper';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';
import { PricingActionType } from '../common/pricing-action-type.enum';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';
import { CreatePriceLockBodyDto, CreatePricingRuleBodyDto, PreviewProductResult } from '../dto/offer-book-rules-body.dto';

export interface ProductWithPrices {
  baseProduct: BaseProductTypeormEntity;
  competitorPrices: Map<Origin, number>;
  offerPrice: number | null;
}

export interface CalculationParams {
  calculationBaseType: CalculationBaseType;
  priceBaseSources?: PriceBaseSource[];
  pricingRules: CreatePricingRuleBodyDto[];
  priceLocks: CreatePriceLockBodyDto[];
  priceRoundingRules?: PriceRoundingRuleTypeormEntity[];
}

@Injectable()
export class OfferBookRulesService {
  public normalizePricingRulesClassifications(pricingRules: CreatePricingRuleBodyDto[]): CreatePricingRuleBodyDto[] {
    return pricingRules.map((rule) => ({
      ...rule,
      classifications: normalizeClassifications(rule.classifications)
    }));
  }

  public normalizePriceLocksClassifications(priceLocks: CreatePriceLockBodyDto[]): CreatePriceLockBodyDto[] {
    return priceLocks.map((lock) => ({
      ...lock,
      classifications: normalizeClassifications(lock.classifications)
    }));
  }

  public validateNonOverlappingPriceLocks(priceLocks: CreatePriceLockBodyDto[]): void {
    const activeLocks = priceLocks.filter((lock) => lock.active !== false);

    if (activeLocks.length === 0) return;

    // Check if any lock targets all classifications (null/empty)
    const allClassificationsLocks = activeLocks.filter((lock) => !lock.classifications || lock.classifications.length === 0);

    if (allClassificationsLocks.length > 0 && activeLocks.length > 1) {
      throw new BadRequestException(
        `Price lock targeting all classifications cannot coexist with other price locks. ` +
          `Remove the "all classifications" lock or remove all other locks.`
      );
    }

    // Check for overlapping classifications between locks
    for (let i = 0; i < activeLocks.length; i++) {
      for (let j = i + 1; j < activeLocks.length; j++) {
        const lockA = activeLocks[i];
        const lockB = activeLocks[j];

        if (this.classificationsOverlap(lockA.classifications, lockB.classifications)) {
          throw new BadRequestException(
            `Price locks overlap: Lock ${i + 1} and Lock ${j + 1} target overlapping classifications. ` +
              `Ensure each classification is only targeted by one price lock.`
          );
        }
      }
    }
  }

  public validateNonOverlappingPricingRules(pricingRules: CreatePricingRuleBodyDto[]): void {
    const activeRules = pricingRules.filter((rule) => rule.active !== false);

    for (let i = 0; i < activeRules.length; i++) {
      for (let j = i + 1; j < activeRules.length; j++) {
        const ruleA = activeRules[i];
        const ruleB = activeRules[j];

        if (this.rulesOverlap(ruleA, ruleB)) {
          throw new BadRequestException(
            `Pricing rules overlap: Rule ${i + 1} and Rule ${j + 1} can target the same products. ` +
              `Ensure classifications and price/margin ranges do not overlap.`
          );
        }
      }
    }
  }

  public calculateProductPreviews(productsWithPrices: ProductWithPrices[], params: CalculationParams): PreviewProductResult[] {
    const results: PreviewProductResult[] = [];

    for (const productData of productsWithPrices) {
      const result = this.calculateProductPreview(productData, params);
      results.push(result);
    }

    return results;
  }

  private calculateProductPreview(productData: ProductWithPrices, params: CalculationParams): PreviewProductResult {
    const { baseProduct, competitorPrices, offerPrice } = productData;

    const currentPrice = this.getCalculationBasePrice(baseProduct, params.calculationBaseType, competitorPrices, offerPrice, params.priceBaseSources);

    const cost = baseProduct.cost ?? 0;
    const basePrice = offerPrice || baseProduct.price;
    const currentMargin = basePrice > 0 ? ((basePrice - cost) / basePrice) * 100 : 0;
    const baseSalePrice = baseProduct.price ?? 0;
    // Normalize classification to second level for display
    const classificationName = baseProduct.classificationEntity?.name ?? '';
    const classification = normalizeClassification(classificationName);
    const baseOfferPrice = offerPrice ?? baseSalePrice;
    // If currentPrice is null, it means we're in STRICT_COMPETITOR_PRICE mode and no competitor price was found
    // Return a skipped result with the product's current state
    if (currentPrice === null) {
      const productCurrentPrice = baseSalePrice;
      const productCurrentMargin = cost > 0 && productCurrentPrice > 0 ? ((productCurrentPrice - cost) / productCurrentPrice) * 100 : 0;

      return {
        ean: baseProduct.ean,
        name: baseProduct.name ?? '',
        externalId: baseProduct.externalId,
        classification,
        baseSalePrice,
        baseOfferPrice: offerPrice ?? baseSalePrice,
        currentPrice: productCurrentPrice,
        currentMargin: Math.round(productCurrentMargin * 100) / 100,
        cost,
        actionType: null,
        percentageValue: 0,
        appliedPercentageValue: 0,
        finalPrice: productCurrentPrice,
        newMargin: Math.round(productCurrentMargin * 100) / 100,
        priceLockApplied: false,
        discountSkipped: false,
        skippedNoCompetitorPrice: true,
        skippedPriceExceedsLimit: false,
        priceRoundingApplied: false
      };
    }

    // Find matching pricing rule
    const matchingRule = this.findMatchingPricingRule(baseProduct, params.pricingRules, currentPrice);

    // Check if price lock applies
    const matchingPriceLock = this.findMatchingPriceLock(baseProduct, params.priceLocks);

    let actionType: PricingActionType | null = null;
    let percentageValue = 0;
    let finalPrice = currentPrice;
    let priceLockApplied = false;

    if (matchingRule) {
      actionType = matchingRule.actionType;
      percentageValue = matchingRule.percentageValue;

      // Apply discount or increase
      if (actionType === PricingActionType.DISCOUNT) {
        finalPrice = currentPrice * (1 - percentageValue / 100);
      } else {
        finalPrice = currentPrice * (1 + percentageValue / 100);
      }
    }

    // Check if increase would exceed the base product sale price
    const shouldSkipPriceExceedsLimit = finalPrice > baseSalePrice && baseSalePrice > 0;

    if (shouldSkipPriceExceedsLimit) {
      return {
        ean: baseProduct.ean,
        name: baseProduct.name ?? '',
        externalId: baseProduct.externalId,
        classification,
        baseSalePrice,
        baseOfferPrice: offerPrice ?? baseSalePrice,
        currentPrice,
        currentMargin: Math.round(currentMargin * 100) / 100,
        cost,
        actionType: matchingRule?.actionType,
        percentageValue: matchingRule?.percentageValue,
        appliedPercentageValue: 0,
        finalPrice: currentPrice,
        newMargin: Math.round(currentMargin * 100) / 100,
        priceLockApplied: false,
        discountSkipped: false,
        skippedNoCompetitorPrice: false,
        skippedPriceExceedsLimit: true,
        priceRoundingApplied: false
      };
    }

    // Calculate new margin before price lock
    let newMargin = cost > 0 ? ((finalPrice - cost) / finalPrice) * 100 : 0;

    // Store the price after rule application, before price lock adjustment
    const priceAfterRule = finalPrice;

    // Apply price lock if:
    // 1. There's a matching price lock, AND
    // 2. Either the current margin OR the new margin is below the minimum margin
    if (matchingPriceLock && (currentMargin < matchingPriceLock.minMargin || newMargin < matchingPriceLock.minMargin)) {
      // Adjust price to meet minimum margin: price = cost / (1 - minMargin/100)
      const minMarginDecimal = matchingPriceLock.minMargin / 100;
      if (minMarginDecimal < 1 && cost > 0) {
        finalPrice = cost / (1 - minMarginDecimal);
        newMargin = matchingPriceLock.minMargin;
        priceLockApplied = true;
      }
    }

    // Calculate the applied percentage value (what was actually applied)
    let appliedPercentageValue = percentageValue;
    if (priceLockApplied && finalPrice !== priceAfterRule && baseOfferPrice > 0) {
      // Price lock changed the final price, calculate the effective percentage
      if (actionType === PricingActionType.DISCOUNT) {
        // For discount: percentage = ((baseOfferPrice - finalPrice) / baseOfferPrice) * 100
        // Note: This can be negative if price lock increased the price instead of applying discount
        appliedPercentageValue = ((baseOfferPrice - finalPrice) / baseOfferPrice) * 100;
      } else if (actionType === PricingActionType.INCREASE) {
        // For increase: percentage = ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100
        appliedPercentageValue = ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100;
      } else {
        // No action type but price lock was applied, calculate as increase
        appliedPercentageValue = ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100;
      }
    }

    let priceRoundingApplied = false;
    const roundingResult = this.applyPriceRounding(finalPrice, params.priceRoundingRules);
    if (roundingResult !== null) {
      finalPrice = roundingResult;
      priceRoundingApplied = true;
      newMargin = cost > 0 ? ((finalPrice - cost) / finalPrice) * 100 : 0;

      if (priceLockApplied && baseOfferPrice > 0) {
        if (actionType === PricingActionType.DISCOUNT) {
          appliedPercentageValue = ((baseOfferPrice - finalPrice) / baseOfferPrice) * 100;
        } else if (actionType === PricingActionType.INCREASE) {
          appliedPercentageValue = ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100;
        } else {
          appliedPercentageValue = ((finalPrice - baseOfferPrice) / baseOfferPrice) * 100;
        }
      }
    }

    return {
      ean: baseProduct.ean,
      name: baseProduct.name ?? '',
      externalId: baseProduct.externalId,
      classification,
      baseSalePrice,
      baseOfferPrice: offerPrice ?? baseSalePrice,
      currentPrice,
      currentMargin: Math.round(currentMargin * 100) / 100,
      cost,
      actionType,
      percentageValue,
      appliedPercentageValue: Math.round(appliedPercentageValue * 100) / 100,
      finalPrice: Math.round(finalPrice * 100) / 100,
      newMargin: Math.round(newMargin * 100) / 100,
      priceLockApplied,
      discountSkipped: false,
      skippedNoCompetitorPrice: false,
      skippedPriceExceedsLimit: false,
      priceRoundingApplied
    };
  }

  private getCalculationBasePrice(
    baseProduct: BaseProductTypeormEntity,
    calculationBaseType: CalculationBaseType,
    competitorPrices: Map<Origin, number>,
    offerPrice: number | null,
    priceBaseSources?: PriceBaseSource[]
  ): number | null {
    switch (calculationBaseType) {
      case CalculationBaseType.SALE_PRICE:
        return baseProduct.price ?? 0;

      case CalculationBaseType.OFFER_PRICE:
        return offerPrice ?? baseProduct.price ?? 0;

      case CalculationBaseType.COMPETITIVE_PRICE:
        return this.getLowestPriceFromSources(baseProduct, competitorPrices, offerPrice, priceBaseSources);

      default:
        return baseProduct.price ?? 0;
    }
  }

  private getLowestPriceFromSources(
    baseProduct: BaseProductTypeormEntity,
    competitorPrices: Map<Origin, number>,
    offerPrice: number | null,
    priceBaseSources?: PriceBaseSource[]
  ): number | null {
    if (!priceBaseSources || priceBaseSources.length === 0) {
      return null;
    }

    const prices: number[] = [];

    for (const source of priceBaseSources) {
      if (source === PriceBaseSource.OWN_PRICE) {
        const ownPrice = offerPrice ?? baseProduct.price;
        if (ownPrice && ownPrice > 0) {
          prices.push(ownPrice);
        }
      } else {
        const originMap: Record<string, Origin> = {
          [PriceBaseSource.DROGAL]: Origin.DROGAL,
          [PriceBaseSource.DROGASIL]: Origin.DROGASIL,
          [PriceBaseSource.PAGUE_MENOS]: Origin.PAGUE_MENOS,
          [PriceBaseSource.IKESAKI]: Origin.IKESAKI,
          [PriceBaseSource.MICHELASSI]: Origin.MICHELASSI
        };

        const origin = originMap[source];
        if (origin) {
          const price = competitorPrices.get(origin);
          if (price && price > 0) {
            prices.push(price);
          }
        }
      }
    }

    if (prices.length === 0) {
      return null;
    }

    return Math.min(...prices);
  }

  private findMatchingPricingRule(
    baseProduct: BaseProductTypeormEntity,
    pricingRules: CreatePricingRuleBodyDto[],
    currentPrice: number
  ): CreatePricingRuleBodyDto | null {
    // Normalize product classification to second level for matching
    const classificationName = baseProduct.classificationEntity?.name ?? '';
    const classification = normalizeClassification(classificationName);
    const margin = baseProduct.margin ?? 0;

    for (const rule of pricingRules) {
      if (rule.active === false) continue;

      // Check classification match (null/undefined means applies to all)
      const classificationMatches = this.classificationMatches(classification, rule.classifications);
      if (!classificationMatches) continue;

      // Check price range (if specified)
      const priceRangeMatches = this.rangeMatches(currentPrice, rule.priceRangeMin, rule.priceRangeMax);

      // Check margin range (if specified)
      const marginRangeMatches = this.rangeMatches(margin, rule.marginRangeMin, rule.marginRangeMax);

      // If both price and margin ranges are specified, it's an AND condition
      const hasPriceRange = rule.priceRangeMin !== undefined || rule.priceRangeMax !== undefined;
      const hasMarginRange = rule.marginRangeMin !== undefined || rule.marginRangeMax !== undefined;

      if (hasPriceRange && hasMarginRange) {
        // AND condition: both price AND margin range must match
        if (priceRangeMatches && marginRangeMatches) {
          return rule;
        }
      } else if (hasPriceRange) {
        if (priceRangeMatches) {
          return rule;
        }
      } else if (hasMarginRange) {
        if (marginRangeMatches) {
          return rule;
        }
      } else {
        // No range specified, just category match is enough
        return rule;
      }
    }

    return null;
  }

  private findMatchingPriceLock(baseProduct: BaseProductTypeormEntity, priceLocks: CreatePriceLockBodyDto[]): CreatePriceLockBodyDto | null {
    // Normalize product classification to second level for matching
    const classificationName = baseProduct.classificationEntity?.name ?? '';
    const classification = normalizeClassification(classificationName);

    for (const lock of priceLocks) {
      if (lock.active === false) continue;

      if (this.classificationMatches(classification, lock.classifications)) {
        return lock;
      }
    }

    return null;
  }

  private applyPriceRounding(price: number, priceRoundingRules?: PriceRoundingRuleTypeormEntity[]): number | null {
    if (!priceRoundingRules || priceRoundingRules.length === 0) {
      return null;
    }

    const matchingRule = priceRoundingRules.find((rule) => price >= rule.priceRangeMin && price <= rule.priceRangeMax);

    if (!matchingRule || !matchingRule.decimalRanges || matchingRule.decimalRanges.length === 0) {
      return null;
    }

    const integerPart = Math.floor(price);
    const decimalPart = Math.round((price - integerPart) * 100) / 100;

    const matchingDecimalRange = matchingRule.decimalRanges.find(
      (range) => decimalPart >= range.decimalRangeFrom && decimalPart <= range.decimalRangeTo
    );

    if (!matchingDecimalRange) {
      return null;
    }

    const roundedPrice = integerPart + matchingDecimalRange.roundTo;

    if (roundedPrice === Math.round(price * 100) / 100) {
      return null;
    }

    return Math.round(roundedPrice * 100) / 100;
  }

  private classificationMatches(classification: string, classifications?: string[]): boolean {
    // null/undefined means applies to all products
    if (!classifications || classifications.length === 0) {
      return true;
    }

    // Check if classification starts with any of the classifications (2nd level match)
    for (const classificationFilter of classifications) {
      if (classification.startsWith(classificationFilter)) {
        return true;
      }
    }

    return false;
  }

  private rangeMatches(value: number, min?: number, max?: number): boolean {
    if (min !== undefined && value < min) return false;
    if (max !== undefined && value > max) return false;
    return true;
  }

  private rulesOverlap(ruleA: CreatePricingRuleBodyDto, ruleB: CreatePricingRuleBodyDto): boolean {
    // Check if classifications overlap
    if (!this.classificationsOverlap(ruleA.classifications, ruleB.classifications)) {
      return false;
    }

    // Check if price/margin ranges overlap
    // Since price and margin are AND conditions within a rule, we need to check if the
    // intersection of conditions results in products that could match both rules
    const ruleAHasPriceRange = ruleA.priceRangeMin !== undefined || ruleA.priceRangeMax !== undefined;
    const ruleAHasMarginRange = ruleA.marginRangeMin !== undefined || ruleA.marginRangeMax !== undefined;
    const ruleBHasPriceRange = ruleB.priceRangeMin !== undefined || ruleB.priceRangeMax !== undefined;
    const ruleBHasMarginRange = ruleB.marginRangeMin !== undefined || ruleB.marginRangeMax !== undefined;

    // If neither rule has any range filters, they overlap (both apply to all)
    if (!ruleAHasPriceRange && !ruleAHasMarginRange && !ruleBHasPriceRange && !ruleBHasMarginRange) {
      return true;
    }

    // If one rule has no range filters, it applies to all products in its classifications
    if (!ruleAHasPriceRange && !ruleAHasMarginRange) {
      return true; // Rule A applies to all, so it overlaps with Rule B
    }
    if (!ruleBHasPriceRange && !ruleBHasMarginRange) {
      return true; // Rule B applies to all, so it overlaps with Rule A
    }

    // Check if price ranges overlap (if both have price ranges or one has both ranges)
    const priceRangesOverlap =
      (ruleAHasPriceRange || ruleBHasPriceRange) &&
      this.rangesOverlap(
        ruleAHasPriceRange ? ruleA.priceRangeMin : undefined,
        ruleAHasPriceRange ? ruleA.priceRangeMax : undefined,
        ruleBHasPriceRange ? ruleB.priceRangeMin : undefined,
        ruleBHasPriceRange ? ruleB.priceRangeMax : undefined
      );

    // Check if margin ranges overlap (if both have margin ranges or one has both ranges)
    const marginRangesOverlap =
      (ruleAHasMarginRange || ruleBHasMarginRange) &&
      this.rangesOverlap(
        ruleAHasMarginRange ? ruleA.marginRangeMin : undefined,
        ruleAHasMarginRange ? ruleA.marginRangeMax : undefined,
        ruleBHasMarginRange ? ruleB.marginRangeMin : undefined,
        ruleBHasMarginRange ? ruleB.marginRangeMax : undefined
      );

    // Determine overlap based on what ranges each rule has
    const ruleAHasBoth = ruleAHasPriceRange && ruleAHasMarginRange;
    const ruleBHasBoth = ruleBHasPriceRange && ruleBHasMarginRange;

    // Case 1: Both rules have both price AND margin ranges
    // They overlap only if both price ranges overlap AND margin ranges overlap
    if (ruleAHasBoth && ruleBHasBoth) {
      return priceRangesOverlap && marginRangesOverlap;
    }

    // Case 2: Rule A has both, Rule B has only one
    if (ruleAHasBoth) {
      // Rule B with only price: overlaps if price ranges overlap (Rule B applies to all margins)
      if (ruleBHasPriceRange && !ruleBHasMarginRange) {
        return priceRangesOverlap;
      }
      // Rule B with only margin: overlaps if margin ranges overlap (Rule B applies to all prices)
      if (ruleBHasMarginRange && !ruleBHasPriceRange) {
        return marginRangesOverlap;
      }
    }

    // Case 3: Rule B has both, Rule A has only one
    if (ruleBHasBoth) {
      // Rule A with only price: overlaps if price ranges overlap (Rule A applies to all margins)
      if (ruleAHasPriceRange && !ruleAHasMarginRange) {
        return priceRangesOverlap;
      }
      // Rule A with only margin: overlaps if margin ranges overlap (Rule A applies to all prices)
      if (ruleAHasMarginRange && !ruleAHasPriceRange) {
        return marginRangesOverlap;
      }
    }

    // Case 4: Both rules have only one range each
    const ruleAOnlyPrice = ruleAHasPriceRange && !ruleAHasMarginRange;
    const ruleAOnlyMargin = !ruleAHasPriceRange && ruleAHasMarginRange;
    const ruleBOnlyPrice = ruleBHasPriceRange && !ruleBHasMarginRange;
    const ruleBOnlyMargin = !ruleBHasPriceRange && ruleBHasMarginRange;

    // Both have only price: check price overlap
    if (ruleAOnlyPrice && ruleBOnlyPrice) {
      return priceRangesOverlap;
    }

    // Both have only margin: check margin overlap
    if (ruleAOnlyMargin && ruleBOnlyMargin) {
      return marginRangesOverlap;
    }

    // One has only price, the other has only margin
    // These could potentially overlap (a product could match both)
    if ((ruleAOnlyPrice && ruleBOnlyMargin) || (ruleAOnlyMargin && ruleBOnlyPrice)) {
      return true; // Conservative: assume potential overlap
    }

    return false;
  }

  private classificationsOverlap(classificationsA?: string[], classificationsB?: string[]): boolean {
    // If either is null/empty, it means "all" - so they overlap
    if (!classificationsA || classificationsA.length === 0) return true;
    if (!classificationsB || classificationsB.length === 0) return true;

    // Check if any classification in A could match any in B (prefix match both ways)
    for (const classA of classificationsA) {
      for (const classB of classificationsB) {
        if (classA.startsWith(classB) || classB.startsWith(classA) || classA === classB) {
          return true;
        }
      }
    }

    return false;
  }

  private rangesOverlap(minA?: number, maxA?: number, minB?: number, maxB?: number): boolean {
    const effectiveMinA = minA ?? -Infinity;
    const effectiveMaxA = maxA ?? Infinity;
    const effectiveMinB = minB ?? -Infinity;
    const effectiveMaxB = maxB ?? Infinity;

    // Ranges overlap if they intersect
    return effectiveMinA <= effectiveMaxB && effectiveMinB <= effectiveMaxA;
  }
}
