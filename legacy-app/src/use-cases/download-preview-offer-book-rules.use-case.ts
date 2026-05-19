import { BadRequestException, Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OfferBookRulesService, ProductWithPrices } from '../services/offer-book-rules.service';
import { PreviewOfferBookRulesBodyDto } from '../dto/offer-book-rules-body.dto';
import { CsvGeneratorService } from '../services/csv-generator.service';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';

@Injectable()
export class DownloadPreviewOfferBookRulesUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerBookRulesService: OfferBookRulesService,
    private readonly csvGeneratorService: CsvGeneratorService,
    private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository
  ) {}

  public async execute(dto: PreviewOfferBookRulesBodyDto): Promise<string> {
    if ((!dto.productIds?.length && !dto.classifications?.length) || (dto.classifications?.length && dto.productIds?.length)) {
      throw new BadRequestException('You must send either a list of productIds or a list of Classifications, but not both');
    }

    const normalizedPricingRules = this.offerBookRulesService.normalizePricingRulesClassifications(dto.pricingRules);
    const normalizedPriceLocks = this.offerBookRulesService.normalizePriceLocksClassifications(dto.priceLocks);

    this.offerBookRulesService.validateNonOverlappingPricingRules(normalizedPricingRules);
    this.offerBookRulesService.validateNonOverlappingPriceLocks(normalizedPriceLocks);

    let baseProducts: BaseProductTypeormEntity[];

    if (dto.productIds && dto.productIds.length > 0) {
      baseProducts = await this.baseProductRepository.findActiveByIds(dto.productIds);
    } else if (dto.classifications && dto.classifications.length > 0) {
      baseProducts = await this.baseProductRepository.findActiveByGroupedClassifications(dto.classifications);
    } else {
      return this.csvGeneratorService.generatePreviewCsv([]);
    }

    if (baseProducts.length === 0) {
      return this.csvGeneratorService.generatePreviewCsv([]);
    }

    const productsWithPrices = await this.getProductsWithPrices(baseProducts, dto.calculationBaseType, dto.priceBaseSources);
    const priceRoundingRules = dto.applyPriceRounding ? await this.priceRoundingRuleRepository.findAllActive() : [];

    const products = this.offerBookRulesService.calculateProductPreviews(productsWithPrices, {
      calculationBaseType: dto.calculationBaseType,
      priceBaseSources: dto.priceBaseSources,
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
