import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { normalizeClassifications } from '../common/normalize-classification.helper';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { UpdateOfferBookRulesBodyDto, CreatePriceLockBodyDto, CreatePricingRuleBodyDto } from '../dto/offer-book-rules-body.dto';
import { OfferBookRulesTypeormEntity } from '../database/entities/offer-book-rules.entity';
import { OfferBookRulesProductsTypeormEntity } from '../database/entities/offer-book-rules-products.entity';
import { OfferBookPricingRulesTypeormEntity } from '../database/entities/offer-book-pricing-rules.entity';
import { OfferBookPriceLocksTypeormEntity } from '../database/entities/offer-book-price-locks.entity';
import { CalculationBaseType } from '../common/calculation-base-type.enum';

@Injectable()
export class UpdateOfferBookRulesUseCase {
  constructor(private readonly offerBookRulesRepository: OfferBookRulesRepository) {}

  public async execute(id: number, dto: UpdateOfferBookRulesBodyDto): Promise<OfferBookRulesTypeormEntity> {
    const existingRules = await this.offerBookRulesRepository.findById(id);
    if (!existingRules) {
      throw new NotFoundException(`OfferBookRules with id ${id} not found`);
    }

    if ((!dto.productIds?.length && !dto.classifications?.length) || (dto.classifications?.length && dto.productIds?.length)) {
      throw new BadRequestException('You must send either a list of productIds or a list of Classifications, but not both');
    }

    const finalCalculationBaseType = dto.calculationBaseType !== undefined ? dto.calculationBaseType : existingRules.calculationBaseType;
    const finalPriceBaseSources = dto.priceBaseSources !== undefined ? dto.priceBaseSources : existingRules.priceBaseSources;

    if (finalCalculationBaseType === CalculationBaseType.COMPETITIVE_PRICE && !finalPriceBaseSources?.length) {
      throw new BadRequestException('priceBaseSources must contain at least one source when calculationBaseType is COMPETITIVE_PRICE');
    }

    // Update basic fields if provided
    if (dto.calculationBaseType !== undefined) existingRules.calculationBaseType = dto.calculationBaseType;
    if (dto.priceBaseSources !== undefined) existingRules.priceBaseSources = dto.priceBaseSources;
    if (dto.applyPriceRounding !== undefined) existingRules.applyPriceRounding = dto.applyPriceRounding;

    if (dto.scheduleEnabled !== undefined) {
      // If enabling schedule, ensure scheduledDays is provided (either in DTO or already exists)
      if (dto.scheduleEnabled) {
        const hasScheduledDaysInDto = dto.scheduledDays && dto.scheduledDays.length > 0;
        const hasExistingScheduledDays = existingRules.scheduledDays && existingRules.scheduledDays.length > 0;

        if (!hasScheduledDaysInDto && !hasExistingScheduledDays) {
          throw new BadRequestException('scheduledDays must be provided when scheduleEnabled is true');
        }
      }

      existingRules.scheduleEnabled = dto.scheduleEnabled;

      // Update scheduledDays if provided in DTO
      if (dto.scheduledDays !== undefined) {
        existingRules.scheduledDays = dto.scheduleEnabled && dto.scheduledDays.length > 0 ? dto.scheduledDays : null;
      } else if (!dto.scheduleEnabled) {
        // If disabling schedule and no scheduledDays provided, clear it
        existingRules.scheduledDays = null;
      }
      // If enabling and no scheduledDays in DTO, keep existing value
    } else if (dto.scheduledDays !== undefined) {
      // Allow updating scheduledDays regardless of scheduleEnabled status
      existingRules.scheduledDays = dto.scheduledDays.length > 0 ? dto.scheduledDays : null;
    }

    if (dto.productIds !== undefined || dto.classifications !== undefined) {
      const bothProvided = dto.productIds !== undefined && dto.classifications !== undefined;
      const hasProductIds = dto.productIds && dto.productIds.length > 0;
      const hasClassifications = dto.classifications && dto.classifications.length > 0;

      if (bothProvided && hasProductIds && hasClassifications) {
        throw new BadRequestException('Cannot provide both productIds and classifications. Provide only one.');
      }

      await this.offerBookRulesRepository.deleteProductsByRulesId(id);

      if (hasProductIds) {
        existingRules.groupedClassifications = null;
        existingRules.products = dto.productIds.map((productId) => {
          const product = new OfferBookRulesProductsTypeormEntity();
          product.offerBookRulesId = id;
          product.baseProductId = productId;
          return product;
        });
      } else if (hasClassifications) {
        existingRules.groupedClassifications = dto.classifications;
        existingRules.products = [];
      } else {
        existingRules.groupedClassifications = null;
        existingRules.products = [];
      }
    }

    // Update pricing rules if provided (replace all)
    if (dto.pricingRules !== undefined) {
      // Normalize classifications to second level
      const normalizedPricingRules = this.normalizePricingRulesClassifications(dto.pricingRules);

      // Validate that no two pricing rules can target the same products
      this.validateNonOverlappingPricingRules(normalizedPricingRules);

      await this.offerBookRulesRepository.deletePricingRulesByRulesId(id);
      existingRules.pricingRules = normalizedPricingRules.map((rule) => {
        const pricingRule = new OfferBookPricingRulesTypeormEntity();
        pricingRule.offerBookRulesId = id;
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
    }

    // Update price locks if provided (replace all)
    if (dto.priceLocks !== undefined) {
      // Normalize classifications to second level
      const normalizedPriceLocks = this.normalizePriceLocksClassifications(dto.priceLocks);

      // Validate that no two price locks can target the same classifications
      this.validateNonOverlappingPriceLocks(normalizedPriceLocks);

      await this.offerBookRulesRepository.deletePriceLocksByRulesId(id);
      existingRules.priceLocks = normalizedPriceLocks.map((lock) => {
        const priceLock = new OfferBookPriceLocksTypeormEntity();
        priceLock.offerBookRulesId = id;
        priceLock.classifications = lock.classifications;
        priceLock.minMargin = lock.minMargin;
        priceLock.active = lock.active ?? true;
        return priceLock;
      });
    }

    // Use batch insertion for large number of products to avoid database parameter limits
    if (existingRules.products && existingRules.products.length > 500) {
      console.log('Using batch insertion for update due to large number of products');
      return this.offerBookRulesRepository.saveWithBatchedProducts(existingRules, 1000);
    }

    return this.offerBookRulesRepository.save(existingRules);
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
    if (!this.classificationsOverlap(ruleA.classifications, ruleB.classifications)) {
      return false;
    }

    const ruleAHasPriceRange = ruleA.priceRangeMin !== undefined || ruleA.priceRangeMax !== undefined;
    const ruleAHasMarginRange = ruleA.marginRangeMin !== undefined || ruleA.marginRangeMax !== undefined;
    const ruleBHasPriceRange = ruleB.priceRangeMin !== undefined || ruleB.priceRangeMax !== undefined;
    const ruleBHasMarginRange = ruleB.marginRangeMin !== undefined || ruleB.marginRangeMax !== undefined;

    if (!ruleAHasPriceRange && !ruleAHasMarginRange && !ruleBHasPriceRange && !ruleBHasMarginRange) {
      return true;
    }

    if (!ruleAHasPriceRange && !ruleAHasMarginRange) return true;
    if (!ruleBHasPriceRange && !ruleBHasMarginRange) return true;

    const priceRangesOverlap =
      ruleAHasPriceRange &&
      ruleBHasPriceRange &&
      this.rangesOverlap(ruleA.priceRangeMin, ruleA.priceRangeMax, ruleB.priceRangeMin, ruleB.priceRangeMax);

    const marginRangesOverlap =
      ruleAHasMarginRange &&
      ruleBHasMarginRange &&
      this.rangesOverlap(ruleA.marginRangeMin, ruleA.marginRangeMax, ruleB.marginRangeMin, ruleB.marginRangeMax);

    const ruleAOnlyPrice = ruleAHasPriceRange && !ruleAHasMarginRange;
    const ruleAOnlyMargin = !ruleAHasPriceRange && ruleAHasMarginRange;
    const ruleBOnlyPrice = ruleBHasPriceRange && !ruleBHasMarginRange;
    const ruleBOnlyMargin = !ruleBHasPriceRange && ruleBHasMarginRange;

    if ((ruleAOnlyPrice && ruleBOnlyMargin) || (ruleAOnlyMargin && ruleBOnlyPrice)) {
      return true;
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
