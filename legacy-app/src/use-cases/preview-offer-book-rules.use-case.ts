import { BadRequestException, Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import { OfferBookRulesService, ProductWithPrices } from '../services/offer-book-rules.service';
import { PreviewOfferBookRulesBodyDto, PaginatedPreviewProductResult } from '../dto/offer-book-rules-body.dto';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { Origin } from '../common/origin.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';

@Injectable()
export class PreviewOfferBookRulesUseCase {
  constructor(
    private readonly baseProductRepository: BaseProductRepository,
    private readonly productRepository: ProductRepository,
    private readonly offerBookRulesService: OfferBookRulesService,
    private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository
  ) {}

  public async execute(dto: PreviewOfferBookRulesBodyDto): Promise<PaginatedPreviewProductResult> {
    if ((!dto.productIds?.length && !dto.classifications?.length) || (dto.classifications?.length && dto.productIds?.length)) {
      throw new BadRequestException('You must send either a list of productIds or a list of Classifications, but not both');
    }

    if (dto.calculationBaseType === CalculationBaseType.COMPETITIVE_PRICE && !dto.priceBaseSources?.length) {
      throw new BadRequestException('priceBaseSources must contain at least one source when calculationBaseType is COMPETITIVE_PRICE');
    }

    const page = dto.page ?? 1;
    const pageSize = Math.min(dto.pageSize ?? 1000, 1000);

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
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      };
    }

    const total = baseProducts.length;

    if (total === 0) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      };
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedBaseProducts = baseProducts.slice(startIndex, endIndex);

    const productsWithPrices = await this.getProductsWithPrices(paginatedBaseProducts, dto.calculationBaseType, dto.priceBaseSources);
    const priceRoundingRules = dto.applyPriceRounding ? await this.priceRoundingRuleRepository.findAllActive() : [];

    const rows = this.offerBookRulesService.calculateProductPreviews(productsWithPrices, {
      calculationBaseType: dto.calculationBaseType,
      priceBaseSources: dto.priceBaseSources,
      pricingRules: normalizedPricingRules,
      priceLocks: normalizedPriceLocks,
      priceRoundingRules
    });

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
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
