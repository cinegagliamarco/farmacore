import { EntityManager } from 'typeorm';
import { BaseProductEntity } from '../../entities/shared-catalog/base-product.entity';

export interface BaseProductUpsertInput {
  ean: string;
  description?: string | null;
  activeIngredient?: string | null;
  generic?: boolean;
}

/**
 * Shared-catalog base_product repository.
 *
 * Plain class instantiated per pipeline step, bound to the tenant
 * EntityManager from runWithTenant. The entity is declared with
 * `schema: 'shared_catalog'` so writes land in the shared catalog
 * regardless of the search_path.
 */
export class BaseProductRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Insert-only by `ean`. base_product is shared identity data — a
   * barcode's meaning doesn't change, so the ERP sync never refreshes
   * existing rows; ON CONFLICT DO NOTHING makes re-syncs and
   * cross-tenant overlap no-ops. Corrections are manual admin edits.
   * Batch is deduped + ean-sorted so concurrent inserts lock in the
   * same order (no deadlock).
   */
  public async insertNewByEan(inputs: BaseProductUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const deduped = this.dedupeByEan(inputs);
    await this.em
      .getRepository(BaseProductEntity)
      .createQueryBuilder()
      .insert()
      .values(deduped)
      .orIgnore()
      .execute();
  }

  private dedupeByEan(
    inputs: BaseProductUpsertInput[],
  ): BaseProductUpsertInput[] {
    const byEan = new Map<string, BaseProductUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    // Sort by ean so concurrent batches lock rows in the same order —
    // otherwise batches sharing eans deadlock on the ON CONFLICT insert.
    return [...byEan.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v);
  }

  public async findEansMissingWeight(): Promise<string[]> {
    return this.findEansMissingPredicate('weight IS NULL');
  }

  /**
   * "Missing measures" matches legacy: cubic_weight was the canonical
   * marker, but the new schema drops that column. Treat "no
   * dimensions" as ALL of height/length/width being null.
   */
  public async findEansMissingMeasures(): Promise<string[]> {
    return this.findEansMissingPredicate(
      'height IS NULL AND length IS NULL AND width IS NULL',
    );
  }

  /**
   * Bulk update with a per-column WHERE IS NULL guard, so two tenants
   * racing on the same base_product end up with one winner and the
   * other's UPDATE is a no-op (read: cross-tenant shared writes are
   * safe).
   */
  public async updateWeights(
    rows: Array<{ ean: string; weight: string | null }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const i = params.length;
      values.push(`($${i + 1}::bigint, $${i + 2}::numeric)`);
      params.push(r.ean, r.weight);
    }
    await this.em.query(
      `UPDATE shared_catalog.base_product AS bp
       SET weight = u.weight, updated_at = now()
       FROM (VALUES ${values.join(', ')}) AS u(ean, weight)
       WHERE bp.ean = u.ean AND bp.weight IS NULL`,
      params,
    );
  }

  public async updateMeasures(
    rows: Array<{
      ean: string;
      weight: string | null;
      height: string | null;
      length: string | null;
      width: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const i = params.length;
      values.push(
        `($${i + 1}::bigint, $${i + 2}::numeric, $${i + 3}::numeric, $${i + 4}::numeric, $${i + 5}::numeric)`,
      );
      params.push(r.ean, r.weight, r.height, r.length, r.width);
    }
    await this.em.query(
      `UPDATE shared_catalog.base_product AS bp
       SET height = COALESCE(bp.height, u.height),
           length = COALESCE(bp.length, u.length),
           width = COALESCE(bp.width, u.width),
           weight = COALESCE(bp.weight, u.weight),
           updated_at = now()
       FROM (VALUES ${values.join(', ')})
         AS u(ean, weight, height, length, width)
       WHERE bp.ean = u.ean
         AND (bp.height IS NULL OR bp.length IS NULL OR bp.width IS NULL OR bp.weight IS NULL)`,
      params,
    );
  }

  private async findEansMissingPredicate(predicate: string): Promise<string[]> {
    const rows: Array<{ ean: string }> = await this.em
      .getRepository(BaseProductEntity)
      .createQueryBuilder('bp')
      .select('bp.ean', 'ean')
      .where(predicate)
      .orderBy('bp.ean', 'ASC')
      .getRawMany();
    return rows.map((r) => String(r.ean));
  }
}
