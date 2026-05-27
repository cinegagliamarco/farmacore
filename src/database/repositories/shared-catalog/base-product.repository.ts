import { EntityManager, In } from 'typeorm';
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
   * Bulk upsert by `ean`, returning a Map<ean, id>. Deduplicates the
   * incoming batch by ean (last-write-wins) — embalagem can carry
   * multiple packagings sharing one barcode, which would otherwise
   * trip ON CONFLICT ("cannot affect row a second time").
   */
  public async upsertManyByEan(
    inputs: BaseProductUpsertInput[],
  ): Promise<Map<string, string>> {
    if (inputs.length === 0) return new Map();
    const deduped = this.dedupeByEan(inputs);
    const repo = this.em.getRepository(BaseProductEntity);
    await repo.upsert(deduped, {
      conflictPaths: ['ean'],
      skipUpdateIfNoValuesChanged: true,
    });
    const eans = deduped.map((d) => d.ean);
    const rows = await repo.find({
      where: { ean: In(eans) },
      select: { id: true, ean: true },
    });
    const out = new Map<string, string>();
    for (const row of rows) out.set(String(row.ean), row.id);
    return out;
  }

  private dedupeByEan(
    inputs: BaseProductUpsertInput[],
  ): BaseProductUpsertInput[] {
    const byEan = new Map<string, BaseProductUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    return [...byEan.values()];
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
