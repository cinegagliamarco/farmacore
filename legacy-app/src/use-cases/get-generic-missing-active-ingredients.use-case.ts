import { Injectable } from '@nestjs/common';
import { BaseProductRepository } from '../database/repositories/base-product.repository';
import { GetGenericMissingActiveIngredientsQueryParamDto, GenericMissingActiveIngredientsFilters } from '../dto/get-generic-missing-active-ingredients-query-param.dto';

export interface MissingActiveIngredients {
  id: number;
  ean: number;
  name: string;
  supplier: string;
}

@Injectable()
export class GetGenericMissingActiveIngredientsUseCase {
  constructor(private readonly baseProductRepository: BaseProductRepository) {}

  public async execute({
    page,
    perPage,
    sortBy,
    sortDirection,
    name,
    eans,
    supplier
  }: GetGenericMissingActiveIngredientsQueryParamDto): Promise<{ rows: MissingActiveIngredients[]; count: number }> {
    const filters: GenericMissingActiveIngredientsFilters = { name, eans, supplier };
    const [results, count] = await this.baseProductRepository.getGenericMissingActiveIngredientsPaginated(
      page,
      perPage,
      sortBy,
      sortDirection,
      filters
    );

    const parsedList: MissingActiveIngredients[] = results.map((baseProduct) => ({
      id: baseProduct.id,
      ean: baseProduct.ean,
      name: baseProduct.name || '-',
      supplier: baseProduct.supplier || '-'
    }));

    return { rows: parsedList, count };
  }
}
