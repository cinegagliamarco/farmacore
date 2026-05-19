import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { normalizeClassifications } from '../common/normalize-classification.helper';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { OfferBookInfoRepository } from '../database/repositories/offer-book-info.repository';
import { CreateOfferBookRulesBodyDto, CreatePriceLockBodyDto, CreatePricingRuleBodyDto } from '../dto/offer-book-rules-body.dto';
import { OfferBookRulesTypeormEntity } from '../database/entities/offer-book-rules.entity';
import { OfferBookRulesProductsTypeormEntity } from '../database/entities/offer-book-rules-products.entity';
import { OfferBookPricingRulesTypeormEntity } from '../database/entities/offer-book-pricing-rules.entity';
import { OfferBookPriceLocksTypeormEntity } from '../database/entities/offer-book-price-locks.entity';
import { CalculationBaseType } from '../common/calculation-base-type.enum';

@Injectable()
export class CreateOfferBookRulesUseCase {
  constructor(
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly offerBookInfoRepository: OfferBookInfoRepository
  ) {}

  public async execute(dto: CreateOfferBookRulesBodyDto): Promise<OfferBookRulesTypeormEntity> {
    if ((!dto.productIds?.length && !dto.classifications?.length) || (dto.classifications?.length && dto.productIds?.length)) {
      throw new BadRequestException('You must send either a list of productIds or a list of Classifications, but not both');
    }

    if (dto.calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE && !dto.priceBaseSources?.length) {
      throw new BadRequestException('priceBaseSources must contain at least one source when calculationBaseType is COMPETITIVE_PRICE');
    }

    // Normalize classifications to second level before validation
    const normalizedPricingRules = this.normalizePricingRulesClassifications(dto.pricingRules);
    const normalizedPriceLocks = this.normalizePriceLocksClassifications(dto.priceLocks);

    // Validate that no two pricing rules can target the same products
    this.validateNonOverlappingPricingRules(normalizedPricingRules);

    // Validate that no two price locks can target the same classifications
    this.validateNonOverlappingPriceLocks(normalizedPriceLocks);

    // Check if offer book info exists
    const offerBookInfo = await this.offerBookInfoRepository.findById(dto.offerBookInfoId);
    if (!offerBookInfo) {
      throw new NotFoundException(`OfferBookInfo with id ${dto.offerBookInfoId} not found`);
    }

    // Check if rules already exist for this offer book info
    const existingRules = await this.offerBookRulesRepository.findByOfferBookInfoId(dto.offerBookInfoId);
    if (existingRules) {
      throw new ConflictException(`OfferBookRules already exist for OfferBookInfo with id ${dto.offerBookInfoId}`);
    }

    const offerBookRules = new OfferBookRulesTypeormEntity();
    offerBookRules.offerBookInfoId = dto.offerBookInfoId;
    offerBookRules.calculationBaseType = dto.calculationBaseType;
    offerBookRules.priceBaseSources = dto.priceBaseSources ?? null;
    offerBookRules.applyPriceRounding = dto.applyPriceRounding ?? false;

    if (dto.scheduleEnabled === true) {
      const hasScheduledDays = dto.scheduledDays && dto.scheduledDays.length > 0;
      if (hasScheduledDays) {
        offerBookRules.scheduleEnabled = true;
        offerBookRules.scheduledDays = dto.scheduledDays;
      } else {
        throw new BadRequestException('scheduledDays must be provided when scheduleEnabled is true');
      }
    } else if (dto.scheduleEnabled === false) {
      offerBookRules.scheduleEnabled = false;
      offerBookRules.scheduledDays = null;
    }

    if (dto.productIds && dto.productIds.length > 0) {
      offerBookRules.groupedClassifications = null;
      offerBookRules.products = dto.productIds.map((productId) => {
        const product = new OfferBookRulesProductsTypeormEntity();
        product.baseProductId = productId;
        return product;
      });
    } else if (dto.classifications && dto.classifications.length > 0) {
      offerBookRules.groupedClassifications = dto.classifications;
      offerBookRules.products = [];
    } else {
      throw new BadRequestException('Either productIds or classifications must be provided');
    }

    // Create pricing rules with normalized classifications
    offerBookRules.pricingRules = normalizedPricingRules.map((rule) => {
      const pricingRule = new OfferBookPricingRulesTypeormEntity();
      pricingRule.classifications = rule.classifications;
      pricingRule.priceRangeMin = rule.priceRangeMin;
      pricingRule.priceRangeMax = rule.priceRangeMax;
      pricingRule.marginRangeMin = rule.marginRangeMin;
      pricingRule.marginRangeMax = rule.marginRangeMax;
      pricingRule.actionType = rule.actionType;
      pricingRule.percentageValue = rule.percentageValue;
      pricingRule.active = rule.active ?? true;
      return pricingRule;
    });

    // Create price locks with normalized classifications
    offerBookRules.priceLocks = normalizedPriceLocks.map((lock) => {
      const priceLock = new OfferBookPriceLocksTypeormEntity();
      priceLock.classifications = lock.classifications;
      priceLock.minMargin = lock.minMargin;
      priceLock.active = lock.active ?? true;
      return priceLock;
    });

    console.log('saving offerBookRules with', offerBookRules.products.length, 'products');

    // Use batch insertion for large number of products to avoid database parameter limits
    if (offerBookRules.products.length > 500) {
      console.log('Using batch insertion due to large number of products');
      return this.offerBookRulesRepository.saveWithBatchedProducts(offerBookRules, 1000);
    }

    return this.offerBookRulesRepository.save(offerBookRules);
  }

  private normalizePricingRulesClassifications(pricingRules: CreatePricingRuleBodyDto[]): CreatePricingRuleBodyDto[] {
    return pricingRules.map((rule) => ({
      ...rule,
      classifications: normalizeClassifications(rule.classifications)
    }));
  }

  private normalizePriceLocksClassifications(priceLocks: CreatePriceLockBodyDto[]): CreatePriceLockBodyDto[] {
    return priceLocks.map((lock) => ({
      ...lock,
      classifications: normalizeClassifications(lock.classifications)
    }));
  }

  private validateNonOverlappingPriceLocks(priceLocks: CreatePriceLockBodyDto[]): void {
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

  private validateNonOverlappingPricingRules(pricingRules: CreatePricingRuleBodyDto[]): void {
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

  private rulesOverlap(ruleA: CreatePricingRuleBodyDto, ruleB: CreatePricingRuleBodyDto): boolean {
    // Check if classifications overlap
    if (!this.classificationsOverlap(ruleA.classifications, ruleB.classifications)) {
      return false;
    }

    // Check if price/margin ranges overlap
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
      return true;
    }
    if (!ruleBHasPriceRange && !ruleBHasMarginRange) {
      return true;
    }

    // Both rules have some range filters
    const priceRangesOverlap =
      ruleAHasPriceRange &&
      ruleBHasPriceRange &&
      this.rangesOverlap(ruleA.priceRangeMin, ruleA.priceRangeMax, ruleB.priceRangeMin, ruleB.priceRangeMax);

    const marginRangesOverlap =
      ruleAHasMarginRange &&
      ruleBHasMarginRange &&
      this.rangesOverlap(ruleA.marginRangeMin, ruleA.marginRangeMax, ruleB.marginRangeMin, ruleB.marginRangeMax);

    // Cross-check: If one uses only price and the other uses only margin, they could potentially overlap
    const ruleAOnlyPrice = ruleAHasPriceRange && !ruleAHasMarginRange;
    const ruleAOnlyMargin = !ruleAHasPriceRange && ruleAHasMarginRange;
    const ruleBOnlyPrice = ruleBHasPriceRange && !ruleBHasMarginRange;
    const ruleBOnlyMargin = !ruleBHasPriceRange && ruleBHasMarginRange;

    if ((ruleAOnlyPrice && ruleBOnlyMargin) || (ruleAOnlyMargin && ruleBOnlyPrice)) {
      return true; // Conservative: assume potential overlap
    }

    return priceRangesOverlap || marginRangesOverlap;
  }

  private classificationsOverlap(classificationsA?: string[], classificationsB?: string[]): boolean {
    if (!classificationsA || classificationsA.length === 0) return true;
    if (!classificationsB || classificationsB.length === 0) return true;

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

    return effectiveMinA <= effectiveMaxB && effectiveMinB <= effectiveMaxA;
  }
}
