import { EntityManager } from 'typeorm';
import { ActiveIngredientEntity } from '../../entities/tenant/active-ingredient.entity';

/**
 * Tenant active_ingredient repository — writes land in the tenant
 * schema selected by runWithTenant's search_path.
 */
export class ActiveIngredientRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Upsert by `name`. Used by sync-base-product to guarantee every
   * referenced active ingredient exists before the products that
   * point to it are written. Empty / null names are filtered out.
   */
  public async upsertNames(
    names: (string | undefined | null)[],
  ): Promise<void> {
    const unique = [
      ...new Set(
        names.filter((n): n is string => !!n && n.trim() !== '').map((n) =>
          n.trim(),
        ),
      ),
    ];
    if (unique.length === 0) return;
    await this.em.getRepository(ActiveIngredientEntity).upsert(
      unique.map((name) => ({ name })),
      { conflictPaths: ['name'], skipUpdateIfNoValuesChanged: true },
    );
  }
}
