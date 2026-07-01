import { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ProductEntity } from '../../entities/shared-catalog/product.entity';
import type { ScrapedProduct } from '../../../scrapers/types';

export interface CompetitorProperties {
  ean: string;
  origin: string;
  name: string | null;
  supplier: string | null;
  brand: string | null;
  weight: string | null;
  height: string | null;
  length: string | null;
  width: string | null;
}

/**
 * Read repo for shared_catalog.product (scraped competitor data).
 * Reads are bounded to DROGAL + DROGASIL since those are the only
 * origins update-base-product-properties consults (matching legacy).
 */
export class SharedProductRepository {
  constructor(private readonly em: EntityManager) {}

  public async findPropertiesByEans(
    eans: string[],
  ): Promise<CompetitorProperties[]> {
    if (eans.length === 0) return [];
    const rows: CompetitorProperties[] = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select([
        'p.ean AS ean',
        'p.origin AS origin',
        'p.name AS name',
        'p.supplier AS supplier',
        'p.brand AS brand',
        'p.weight AS weight',
        'p.height AS height',
        'p.length AS length',
        'p.width AS width',
      ])
      .where('p.ean = ANY(:eans::bigint[])', { eans })
      .andWhere("p.origin IN ('DROGAL', 'DROGASIL')")
      .getRawMany();
    return rows.map((r) => ({
      ...r,
      ean: String(r.ean),
    }));
  }

  /**
   * Bulk upsert scraped competitor products by (ean, origin). Genuine
   * `found: false` records (the EAN isn't on this origin's catalog) are
   * persisted with `found` false and most columns null, so the row reflects
   * "not sold here" and the daily import skips it from then on.
   *
   * Scrapes with `error` set are transport failures (HTTP 403/timeout in
   * the scraper's catch) — we don't know the current state, so we SKIP
   * them rather than overwrite the last good price with null. A blocked or
   * flaky sweep therefore preserves the previous snapshot instead of
   * corrupting it.
   */
  public async upsertScrapes(scrapes: ScrapedProduct[]): Promise<void> {
    const persistable = scrapes.filter((s) => !s.error);
    if (persistable.length === 0) return;
    const repo = this.em.getRepository(ProductEntity);
    const rows = persistable.map((s) => ({
      ean: s.ean,
      origin: s.origin,
      found: s.found,
      name: s.name ?? null,
      url: s.url ?? null,
      price: s.price ?? null,
      unitSalePrice: s.unitSalePrice ?? null,
      supplier: s.supplier ?? null,
      brand: s.brand ?? null,
      sku: s.sku ?? null,
      weight: s.weight ?? null,
      height: s.height ?? null,
      length: s.length ?? null,
      width: s.width ?? null,
      metadata: { ...(s.metadata ?? {}) },
    })) as QueryDeepPartialEntity<ProductEntity>[];
    await repo.upsert(rows, {
      conflictPaths: ['ean', 'origin'],
      indexPredicate: 'deleted_at IS NULL',
      skipUpdateIfNoValuesChanged: true,
    });
  }

  /**
   * (ean, origin) pairs already known not to be sold on that origin
   * (found = false), grouped by origin. The import dispatcher subtracts
   * these from the scrape universe so a not-found EAN is never re-scraped.
   */
  public async findNotFoundEansByOrigins(
    origins: string[],
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (origins.length === 0) return result;
    const rows: Array<{ ean: string; origin: string }> = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select(['p.ean AS ean', 'p.origin AS origin'])
      .where('p.origin = ANY(:origins)', { origins })
      .andWhere('p.found = false')
      .getRawMany();
    for (const r of rows) {
      const set = result.get(r.origin) ?? new Set<string>();
      set.add(String(r.ean));
      result.set(r.origin, set);
    }
    return result;
  }

  /**
   * Stock-fetch candidates: (ean, sku) pairs for an origin where the
   * scraper has already populated a SKU. The stock dispatcher chunks
   * the result into per-origin batches. Rows without sku (found=false
   * scrapes) are filtered out — no point fetching stock without a sku.
   */
  public async findStockCandidatesByOrigin(
    origin: string,
  ): Promise<Array<{ ean: string; sku: string }>> {
    const rows: Array<{ ean: string; sku: string }> = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select(['p.ean AS ean', 'p.sku AS sku'])
      .where('p.origin = :origin', { origin })
      .andWhere('p.sku IS NOT NULL')
      .orderBy('p.ean', 'ASC')
      .getRawMany();
    return rows.map((r) => ({ ean: String(r.ean), sku: String(r.sku) }));
  }
}
