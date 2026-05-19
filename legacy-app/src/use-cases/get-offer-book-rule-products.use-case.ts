import { Injectable, NotFoundException } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { PaginatedOfferBookRuleProductResult } from '../dto/offer-book-rules-body.dto';

@Injectable()
export class GetOfferBookRuleProductsUseCase {
  constructor(
    private readonly offerBookRulesRepository: OfferBookRulesRepository,
    private readonly baseProductRepository: BaseProductRepository
  ) {}

  public async execute(id: number, page: number = 1, pageSize: number = 300, name?: string): Promise<PaginatedOfferBookRuleProductResult> {
    const offerBookRules = await this.offerBookRulesRepository.findByIdWithDetails(id);

    if (!offerBookRules) {
      throw new NotFoundException(`Offer book rules with ID ${id} not found`);
    }

    pageSize = Math.min(pageSize, 300);

    const productIds = offerBookRules.groupedClassifications?.length ? [] : await this.offerBookRulesRepository.findProductIdsByRulesId(id);

    const [baseProducts, total] = await this.baseProductRepository.findByOfferBookRulePaginated(
      productIds,
      offerBookRules.groupedClassifications,
      page,
      pageSize,
      name
    );

    if (total === 0) {
      return {
        rows: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      };
    }

    const rows = baseProducts.map((product) => ({
      ean: product.ean,
      name: product.name ?? '',
      externalId: product.externalId ?? 0,
      classification: product.classificationEntity?.name ?? '',
      currentPrice: product.price ?? 0,
      currentMargin: product.margin ?? 0,
      cost: product.cost ?? 0
    }));

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  }
}
