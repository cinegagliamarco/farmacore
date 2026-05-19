import { Injectable } from '@nestjs/common';
import { Origin } from '../common/origin.enum';
import { SubsidiaryName } from '../common/subsidiary-name.enum';
import { ActiveIngredientTypeormEntity } from '../database/entities/active-ingredient.entity';
import { BaseProductTypeormEntity } from '../database/entities/base-product.entity';
import { ProductTypeormEntity } from '../database/entities/product.entity';
import { ActiveIngredientsRepository } from '../database/repositories/active-ingredients.repository';
import { ProductRepository } from '../database/repositories/product.repository';
import {
  GetProductsByActiveIngredientQueryParamDto,
  ProductsByActiveIngredientFilters
} from '../dto/get-products-by-active-ingredient-query-param.dto';

export interface ProductVariant {
  id: number;
  ean: number;
  name: string;
  cost: string;
  price: string;
  margin: string;
  mat: number;
  supplier?: string;
  offerBook?: {
    name?: string;
    externalId?: number;
    priceForOffer?: number;
  };
  drogalPrice: string;
  drogasilPrice: string;
  stock: Record<string, number>;
  drogalStock: Record<string, number>;
  drogasilStock: Record<string, number>;
}

export interface ActiveIngredientGroupResponse {
  activeIngredient: string;
  matActiveIngredient: number;
  targetPrice: string;
  variants: ProductVariant[];
}

@Injectable()
export class GetProductsByActiveIngredientUseCase {
  constructor(
    private readonly activeIngredientsRepository: ActiveIngredientsRepository,
    private readonly productRepository: ProductRepository
  ) {}

  public async execute({
    page,
    perPage,
    activeIngredient,
    sortBy,
    sortDirection
  }: GetProductsByActiveIngredientQueryParamDto): Promise<{ rows: ActiveIngredientGroupResponse[]; count: number }> {
    const filters: ProductsByActiveIngredientFilters = { activeIngredient, sortBy, sortDirection };

    const [activeIngredients, count] = await this.activeIngredientsRepository.getActiveIngredientsWithBaseProducts(page, perPage, filters);

    const eans = activeIngredients.flatMap((ai) => ai.baseProducts?.map((bp) => bp.ean) ?? []);
    const competitorProducts = await this.productRepository.findByEansAndOrigins(eans, [Origin.DROGAL, Origin.DROGASIL]);
    const competitorMap = this.buildCompetitorMap(competitorProducts);

    const rows = activeIngredients.map((ai) => this.mapActiveIngredientToResponse(ai, competitorMap));

    return { rows, count };
  }

  private buildCompetitorMap(products: ProductTypeormEntity[]): Record<string, ProductTypeormEntity> {
    const map: Record<string, ProductTypeormEntity> = {};
    for (const product of products) {
      map[`${product.ean}-${product.origin}`] = product;
    }
    return map;
  }

  private mapActiveIngredientToResponse(
    activeIngredient: ActiveIngredientTypeormEntity,
    competitorMap: Record<string, ProductTypeormEntity>
  ): ActiveIngredientGroupResponse {
    const variants = activeIngredient.baseProducts.map((bp) => this.mapBaseProductToVariant(bp, competitorMap));

    const prices = variants.map((v) => parseFloat(v.price)).filter((p) => p > 0);
    const targetPrice = prices.length > 0 ? Math.min(...prices) : 0;

    return {
      activeIngredient: activeIngredient.name,
      matActiveIngredient: activeIngredient.mat,
      targetPrice: targetPrice.toFixed(2),
      variants
    };
  }

  private mapBaseProductToVariant(baseProduct: BaseProductTypeormEntity, competitorMap: Record<string, ProductTypeormEntity>): ProductVariant {
    const stock = this.buildStockRecord(baseProduct);
    const drogalProduct = competitorMap[`${baseProduct.ean}-${Origin.DROGAL}`];
    const drogasilProduct = competitorMap[`${baseProduct.ean}-${Origin.DROGASIL}`];

    const variant: ProductVariant = {
      id: baseProduct.id,
      ean: baseProduct.ean,
      name: baseProduct.name || '-',
      cost: (baseProduct.cost || 0).toFixed(2),
      price: (baseProduct.price || 0).toFixed(2),
      margin: `${(baseProduct.margin || 0).toFixed(2)}%`,
      mat: baseProduct.mat || 0,
      supplier: baseProduct.supplier,
      drogalPrice: (drogalProduct?.price ?? 0).toFixed(2),
      drogasilPrice: (drogasilProduct?.price ?? 0).toFixed(2),
      stock,
      drogalStock: {
        [SubsidiaryName.LOJA_1]: drogalProduct?.stock?.subsidiaryOneStock ?? 0,
        [SubsidiaryName.LOJA_2]: drogalProduct?.stock?.subsidiaryTwoStock ?? 0
      },
      drogasilStock: {
        [SubsidiaryName.LOJA_1]: drogasilProduct?.stock?.subsidiaryOneStock ?? 0,
        [SubsidiaryName.LOJA_2]: drogasilProduct?.stock?.subsidiaryTwoStock ?? 0
      }
    };

    if (baseProduct.offerBooks?.length) {
      variant.offerBook = {
        name: baseProduct.offerBooks[0].name,
        externalId: baseProduct.offerBooks[0].externalId,
        priceForOffer: baseProduct.offerBooks[0].priceForOffer
      };
    }

    return variant;
  }

  private buildStockRecord(baseProduct: BaseProductTypeormEntity): Record<string, number> {
    const stock: Record<string, number> = {};
    for (const subsidiaryName of Object.values(SubsidiaryName)) {
      stock[subsidiaryName] = 0;
    }
    baseProduct.stocks?.forEach((stockItem) => {
      stock[stockItem.subsidiaryName] = stockItem.quantity;
    });
    return stock;
  }
}
