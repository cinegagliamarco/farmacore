import { Injectable } from '@nestjs/common';
import { FindOptionsOrder, ILike, Repository } from 'typeorm';
import { ActiveIngredientTypeormEntity } from '../entities/active-ingredient.entity';
import { ProductsByActiveIngredientFilters, SortableColumn } from '../../dto/get-products-by-active-ingredient-query-param.dto';

@Injectable()
export class ActiveIngredientsRepository {
  constructor(private readonly repository: Repository<ActiveIngredientTypeormEntity>) {}

  public async getActiveIngredientsPaginated(page: number, pageSize: number): Promise<[ActiveIngredientTypeormEntity[], number]> {
    return this.repository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize
    });
  }

  public async getActiveIngredientsWithBaseProducts(
    page: number,
    pageSize: number,
    filters?: ProductsByActiveIngredientFilters
  ): Promise<[ActiveIngredientTypeormEntity[], number]> {
    const fieldMap: Record<SortableColumn, keyof ActiveIngredientTypeormEntity> = {
      activeIngredient: 'name',
      matActiveIngredient: 'mat'
    };

    const order: FindOptionsOrder<ActiveIngredientTypeormEntity> = {};
    filters?.sortBy?.forEach((key, i) => {
      const field = fieldMap[key];
      if (!field) return;
      order[field] = filters?.sortDirection?.[i] === 'DESC' ? 'DESC' : 'ASC';
    });
    if (Object.keys(order).length === 0) order.name = 'ASC';

    return this.repository.findAndCount({
      where: filters?.activeIngredient ? { name: ILike(`%${filters.activeIngredient}%`) } : undefined,
      relations: ['baseProducts', 'baseProducts.stocks', 'baseProducts.offerBooks'],
      order,
      skip: ((page <= 0 ? 1 : page) - 1) * pageSize,
      take: pageSize
    });
  }

  public async getActiveIngredients(): Promise<ActiveIngredientTypeormEntity[]> {
    return this.repository.find();
  }

  public async upsertBatch(ingredients: Partial<ActiveIngredientTypeormEntity>[]): Promise<void> {
    if (ingredients.length === 0) return;

    await this.repository.upsert(ingredients, ['externalId']);
  }

  /**
   * Upsert active ingredients by `name`. Used by the base-product sync to guarantee
   * `base_product.active_ingredient` always has a matching row before the FK is set.
   */
  public async upsertNames(names: (string | undefined | null)[]): Promise<void> {
    const uniqueNames = [...new Set(names.filter((n): n is string => !!n && n.trim() !== ''))];
    if (uniqueNames.length === 0) return;

    await this.repository.upsert(
      uniqueNames.map((name) => ({ name })),
      ['name']
    );
  }

  public async updateMatFromBaseProducts(): Promise<void> {
    await this.repository.query(`
      UPDATE active_ingredient ai
      SET mat = COALESCE(subquery.total_mat, 0),
          updated_date = NOW()
      FROM (
        SELECT bp.active_ingredient, SUM(COALESCE(bp.mat, 0)) as total_mat
        FROM base_product bp
        WHERE bp.active_ingredient IS NOT NULL
        GROUP BY bp.active_ingredient
      ) subquery
      WHERE ai.name = subquery.active_ingredient
    `);
  }
}
