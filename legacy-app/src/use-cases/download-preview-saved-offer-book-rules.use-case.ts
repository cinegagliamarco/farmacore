import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OfferBookRulesService, ProductWithPrices } from '../services/offer-book-rules.service';
import { CreatePriceLockBodyDto, CreatePricingRuleBodyDto } from '../dto/offer-book-rules-body.dto';
import { CsvGeneratorService } from '../services/csv-generator.service';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';

@Injectable()
export class DownloadPreviewSavedOfferBookRulesUseCase {
  constructor(
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerBookRulesService: OfferBookRulesService,
    private readonly csvGeneratorService: CsvGeneratorService,
    private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository
  ) {}

  public async execute(id: number): Promise<string> {
    const offerBookRules = await this.offerBookRulesRepository.findByIdWithDetails(id);

    if (!offerBookRules) {
      throw new NotFoundException(`Offer book rules with ID ${id} not found`);
    }

    let productIds: number[];

    if (offerBookRules.groupedClassifications && offerBookRules.groupedClassifications.length > 0) {
      const allBaseProducts = await this.baseProductRepository.findActiveByGroupedClassifications(offerBookRules.groupedClassifications);
      productIds = allBaseProducts.map((p) => p.id);
    } else {
      productIds = await this.offerBookRulesRepository.findProductIdsByRulesId(id);
    }

    if (productIds.length === 0) {
      return this.csvGeneratorService.generatePreviewCsv([]);
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

    const baseProducts = await this.baseProductRepository.findActiveByIds(productIds);

    if (baseProducts.length === 0) {
      return this.csvGeneratorService.generatePreviewCsv([]);
    }

    const productsWithPrices = await this.getProductsWithPrices(
      baseProducts,
      offerBookRules.calculationBaseType,
      offerBookRules.priceBaseSources ?? undefined
    );
    const priceRoundingRules = offerBookRules.applyPriceRounding ? await this.priceRoundingRuleRepository.findAllActive() : [];

    const products = this.offerBookRulesService.calculateProductPreviews(productsWithPrices, {
      calculationBaseType: offerBookRules.calculationBaseType,
      priceBaseSources: offerBookRules.priceBaseSources ?? undefined,
      pricingRules: normalizedPricingRules,
      priceLocks: normalizedPriceLocks,
      priceRoundingRules
    });

    return this.csvGeneratorService.generatePreviewCsv(products);
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
