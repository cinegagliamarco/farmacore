import { EntityManager } from 'typeorm';
import { BaseProductEntity } from '../../entities/shared-catalog/base-product.entity';

export interface BaseProductUpsertInput {
  ean: string;
  description?: string | null;
  generic?: boolean;
}

export interface BaseProductAdminRow {
  ean: string;
  description: string | null;
  activeIngredient: string | null;
  generic: boolean;
  updatedAt: Date;
}

export interface BaseProductSearchQuery {
  /** Matches ean, description or active_ingredient (ILIKE substring). */
  search?: string;
  missingActiveIngredient?: boolean;
  generic?: boolean;
  limit: number;
  offset: number;
}

/**
 * Shared-catalog base_product repository.
 *
 * Plain class bound to whatever EntityManager the caller holds: pipeline
 * steps pass the tenant EM from runWithTenant, the admin curation API
 * (BaseProductsAdminService) passes the default DataSource manager. The
 * entity is declared with `schema: 'shared_catalog'` so access lands in
 * the shared catalog regardless of the search_path.
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

  /** Paginated admin search over the internal cadastre (EAN ↔ princípio
   *  ativo curation — see /admin/catalog/base-products). */
  public async search(
    q: BaseProductSearchQuery,
  ): Promise<{ rows: BaseProductAdminRow[]; count: number }> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q.search) {
      // % e _ do usuário são busca literal, não curinga de ILIKE.
      params.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(
        `(bp.ean::text ILIKE $${params.length} OR bp.description ILIKE $${params.length} OR bp.active_ingredient ILIKE $${params.length})`,
      );
    }
    if (q.missingActiveIngredient) clauses.push('bp.active_ingredient IS NULL');
    if (q.generic !== undefined) {
      params.push(q.generic);
      clauses.push(`bp.generic = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const countRows: Array<{ count: string }> = await this.em.query(
      `SELECT count(*)::int AS count FROM shared_catalog.base_product bp ${where}`,
      params,
    );
    const rows: BaseProductAdminRow[] = await this.em.query(
      `SELECT bp.ean::text AS ean, bp.description,
              bp.active_ingredient AS "activeIngredient", bp.generic,
              bp.updated_at AS "updatedAt"
         FROM shared_catalog.base_product bp ${where}
        ORDER BY bp.ean
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, q.offset],
    );
    return { rows, count: Number(countRows[0]?.count ?? 0) };
  }

  public async updateIdentityByEan(
    ean: string,
    patch: {
      description?: string | null;
      activeIngredient?: string | null;
      generic?: boolean;
    },
  ): Promise<number> {
    const res = await this.em
      .getRepository(BaseProductEntity)
      .update({ ean }, patch);
    return res.affected ?? 0;
  }

  public async listActiveIngredients(): Promise<
    Array<{ name: string; eans: number }>
  > {
    return this.em.query(
      `SELECT active_ingredient AS name, count(*)::int AS eans
         FROM shared_catalog.base_product
        WHERE active_ingredient IS NOT NULL
        GROUP BY active_ingredient
        ORDER BY active_ingredient`,
    );
  }

  public async renameActiveIngredient(
    from: string,
    to: string,
  ): Promise<number> {
    const res = await this.em
      .getRepository(BaseProductEntity)
      .createQueryBuilder()
      .update()
      .set({ activeIngredient: to })
      .where('active_ingredient = :from', { from })
      .execute();
    return res.affected ?? 0;
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
