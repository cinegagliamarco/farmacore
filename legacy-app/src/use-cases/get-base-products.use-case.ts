import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { BaseProductFilters, GetBaseProductsQueryParamDto } from '../dto/get-base-products-query-param.dto';

@Injectable()
export class GetBaseProductsUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute(dto: GetBaseProductsQueryParamDto): Promise<{ rows: Record<string, unknown>[]; count: number }> {
    const { page, perPage, sortBy, sortDirection, curve, name, eans, origin, generic, classification, active } = dto;
    const filters: BaseProductFilters = { curve, name, eans, generic, origin, classification, active };
    const [results, count] = await this.baseProductRepository.getBaseProductsPaginated(page, perPage, sortBy, sortDirection, filters);

    const parsedList = results.map((baseProduct) => ({
      id: baseProduct.id,
      ean: baseProduct.ean,
      name: baseProduct.name,
      active: baseProduct.active,
      supplier: baseProduct.supplier,
      mat: baseProduct.mat || 0,
      curve: baseProduct.curve,
      origin: baseProduct.origin,
      activeIngredient: baseProduct.activeIngredient,
      generic: baseProduct.generic,
      weight: baseProduct.weight,
      cubicWeight: baseProduct.cubicWeight,
      height: baseProduct.height,
      length: baseProduct.length,
      width: baseProduct.width,
      classification: baseProduct.classificationEntity?.name,
      images: baseProduct.images?.map((image) => image.url) || [],
      updatedDate: baseProduct.updatedDate
    }));

    return { rows: parsedList, count };
  }
}
