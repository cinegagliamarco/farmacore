import { EntityManager } from 'typeorm';
import {
  ProductDeal,
  ProductEntity,
} from '../../entities/tenant/product.entity';

export interface ProductUpsertInput {
  ean: string;
  externalId?: string | null;
  name?: string | null;
  active?: boolean;
  price?: string | null;
  cost?: string | null;
  averageUnitCost?: string | null;
  unitSalePrice?: string | null;
  supplier?: string | null;
  receiptDate?: Date | string | null;
  monitored?: boolean;
  classificationId?: string | null;
  deals?: Record<string, ProductDeal> | null;
  description?: string | null;
  activeIngredient?: string | null;
  generic?: boolean;
}

/**
 * Per-tenant projection of a product. Writes the ERP-sourced view that
 * the shared catalog deliberately omits: external_id, name, prices,
 * supplier, receipt date, monitored flag, classification FK, deals jsonb.
 */
export class ProductRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Bulk upsert by `ean` (the per-tenant natural key). Like the shared
   * base_product upsert, dedupes the batch by ean and releases stale
   * external_ids so the unique constraint on external_id never trips
   * when an embalagem id is reassigned to a new barcode.
   */
  public async upsertManyByEan(inputs: ProductUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    const repo = this.em.getRepository(ProductEntity);
    const deduped = this.dedupeByEan(inputs);
    await this.releaseConflictingExternalIds(deduped);
    await repo.upsert(
      deduped.map((d) => ({
        ...d,
        active: d.active ?? true,
        monitored: d.monitored ?? false,
        generic: d.generic ?? false,
      })),
      { conflictPaths: ['ean'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private dedupeByEan(inputs: ProductUpsertInput[]): ProductUpsertInput[] {
    const byEan = new Map<string, ProductUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    // Sort by ean so concurrent batches lock rows in the same order —
    // otherwise batches sharing eans deadlock on the ON CONFLICT upsert.
    return [...byEan.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => v);
  }

  private async releaseConflictingExternalIds(
    chunk: ProductUpsertInput[],
  ): Promise<void> {
    const withExternal = chunk
      .filter((c) => c.externalId != null)
      .map((c) => ({ ean: String(c.ean), externalId: String(c.externalId) }));
    if (withExternal.length === 0) return;
    const externalIds = withExternal.map((p) => p.externalId);
    const eans = withExternal.map((p) => p.ean);
    await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder()
      .update()
      .set({ externalId: () => 'NULL' })
      .where('external_id IN (:...externalIds)', { externalIds })
      .andWhere('ean NOT IN (:...eans)', { eans })
      .execute();
  }

  /**
   * EAN universe of the tenant — used by calc-base-product-metrics and
   * update-base-product-properties dispatchers to chunk the work.
   */
  public async findAllEans(): Promise<string[]> {
    const rows: Array<{ ean: string }> = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select('p.ean', 'ean')
      .orderBy('p.ean', 'ASC')
      .getRawMany();
    return rows.map((r) => String(r.ean));
  }

  /**
   * Bulk metrics update via a single UPDATE ... FROM (VALUES ...) so
   * 500 rows go in one statement instead of 500. Numeric fields are
   * cast back from text via the VALUES tuples; null inputs are passed
   * verbatim.
   */
  public async updateMetricsBatch(
    rows: Array<{
      ean: string;
      margin: number | null;
      averageVariation: number | null;
      status: string | null;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const i = params.length;
      values.push(
        `($${i + 1}::bigint, $${i + 2}::numeric, $${i + 3}::numeric, $${i + 4}::text)`,
      );
      params.push(r.ean, r.margin, r.averageVariation, r.status);
    }
    await this.em.query(
      `UPDATE product AS p
       SET margin = u.margin,
           average_variation = u.average_variation,
           status = u.status,
           updated_at = now()
       FROM (VALUES ${values.join(', ')})
         AS u(ean, margin, average_variation, status)
       WHERE p.ean = u.ean`,
      params,
    );
  }

  public async findEansMissingSupplier(): Promise<string[]> {
    return this.findEansMissingColumn('supplier');
  }

  public async findEansMissingName(): Promise<string[]> {
    return this.findEansMissingColumn('name');
  }

  /**
   * Single-column bulk update used by update-base-product-properties
   * for the supplier and name passes. The WHERE clause keeps the write
   * idempotent — already-populated rows are left alone, so two tenants
   * scraping the same EAN don't fight over the value.
   */
  public async updateColumnByEan(
    column: 'supplier' | 'name',
    rows: Array<{ ean: string; value: string | null }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    for (const r of rows) {
      const i = params.length;
      values.push(`($${i + 1}::bigint, $${i + 2}::text)`);
      params.push(r.ean, r.value);
    }
    await this.em.query(
      `UPDATE product AS p
       SET ${column} = u.value, updated_at = now()
       FROM (VALUES ${values.join(', ')}) AS u(ean, value)
       WHERE p.ean = u.ean AND p.${column} IS NULL`,
      params,
    );
  }

  private async findEansMissingColumn(
    column: 'supplier' | 'name',
  ): Promise<string[]> {
    const rows: Array<{ ean: string }> = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select('p.ean', 'ean')
      .where(`p.${column} IS NULL`)
      .orderBy('p.ean', 'ASC')
      .getRawMany();
    return rows.map((r) => String(r.ean));
  }
}
