import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OfferBookRulesService, ProductWithPrices } from '../services/offer-book-rules.service';
import { CreatePriceLockBodyDto, CreatePricingRuleBodyDto, PaginatedPreviewProductResult } from '../dto/offer-book-rules-body.dto';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';

@Injectable()
export class PreviewSavedOfferBookRulesUseCase {
  constructor(
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerBookRulesService: OfferBookRulesService,
    private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository
  ) {}

  public async execute(id: number, page: number = 1, pageSize: number = 1000): Promise<PaginatedPreviewProductResult> {
    const offerBookRules = await this.offerBookRulesRepository.findByIdWithDetails(id);

    if (!offerBookRules) {
      throw new NotFoundException(`Offer book rules with ID ${id} not found`);
    }

    pageSize = Math.min(pageSize, 1000);

    const offset = (page - 1) * pageSize;

    let baseProducts: BaseProductTypeormEntity[];
    let totalProducts: number;

    if (offerBookRules.groupedClassifications && offerBookRules.groupedClassifications.length > 0) {
      [baseProducts, totalProducts] = await this.baseProductRepository.findActiveByGroupedClassificationsPaginated(
        offerBookRules.groupedClassifications,
        offset,
        pageSize
      );
    } else {
      [baseProducts, totalProducts] = await this.baseProductRepository.findActiveByOfferBookRulesPaginated(id, offset, pageSize);
    }

    if (totalProducts === 0) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      };
    }

    const pricingRules: CreatePricingRuleBodyDto[] = offerBookRules.pricingRules.map((rule) => ({
      classifications: rule.classifications ?? undefined,
      priceRangeMin: rule.priceRangeMin ?? undefined,
      priceRangeMax: rule.priceRangeMax ?? undefined,
      marginRangeMin: rule.marginRangeMin ?? undefined,
      marginRangeMax: rule.marginRangeMax ?? undefined,
      actionType: rule.actionType,
      percentageValue: rule.percentageValue,
      active: rule.active
    }));

    const priceLocks: CreatePriceLockBodyDto[] = offerBookRules.priceLocks.map((lock) => ({
      classifications: lock.classifications ?? undefined,
      minMargin: lock.minMargin,
      active: lock.active
    }));

    const normalizedPricingRules = this.offerBookRulesService.normalizePricingRulesClassifications(pricingRules);
    const normalizedPriceLocks = this.offerBookRulesService.normalizePriceLocksClassifications(priceLocks);

    if (baseProducts.length === 0) {
      return {
        rows: [],
        total: totalProducts,
        page,
        pageSize,
        totalPages: Math.ceil(totalProducts / pageSize)
      };
    }

    const productsWithPrices = await this.getProductsWithPrices(
      baseProducts,
      offerBookRules.calculationBaseType,
      offerBookRules.priceBaseSources ?? undefined
    );
    const priceRoundingRules = offerBookRules.applyPriceRounding ? await this.priceRoundingRuleRepository.findAllActive() : [];

    const rows = this.offerBookRulesService.calculateProductPreviews(productsWithPrices, {
      calculationBaseType: offerBookRules.calculationBaseType,
      priceBaseSources: offerBookRules.priceBaseSources ?? undefined,
      pricingRules: normalizedPricingRules,
      priceLocks: normalizedPriceLocks,
      priceRoundingRules
    });

    return {
      rows,
      total: totalProducts,
      page,
      pageSize,
      totalPages: Math.ceil(totalProducts / pageSize)
    };
  }

  private async getProductsWithPrices(
    baseProducts: BaseProductTypeormEntity[],
    calculationBaseType: CalculationBaseType,
    priceBaseSources?: PriceBaseSource[]
  ): Promise<ProductWithPrices[]> {
    const eans = baseProducts.map((bp) => bp.ean);

    let pricesByOrigin = new Map<string, Map<Origin, number>>();

    if (calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE && priceBaseSources && priceBaseSources.length > 0) {
      const origins = priceBaseSources
        .filter((source) => source !== PriceBaseSource.OWN_PRICE)
        .map((source) => {
          const originMap: Record<string, Origin> = {
            [PriceBaseSource.DROGAL]: Origin.DROGAL,
            [PriceBaseSource.DROGASIL]: Origin.DROGASIL,
            [PriceBaseSource.PAGUE_MENOS]: Origin.PAGUE_MENOS,
            [PriceBaseSource.IKESAKI]: Origin.IKESAKI,
            [PriceBaseSource.MICHELASSI]: Origin.MICHELASSI
          };
          return originMap[source];
        })
        .filter((origin): origin is Origin => origin !== undefined);

      if (origins.length > 0) {
        pricesByOrigin = await this.productRepository.getPricesByEansAndOrigins(eans, origins);
      }
    }

    return baseProducts.map((baseProduct) => {
      const competitorPrices = pricesByOrigin.get(String(baseProduct.ean)) ?? new Map<Origin, number>();
      const offerPrice = baseProduct.offerBooks?.[0]?.priceForOffer ?? null;

      return {
        baseProduct,
        competitorPrices,
        offerPrice
      };
    });
  }
}
