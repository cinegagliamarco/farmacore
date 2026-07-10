import { EntityManager } from 'typeorm';
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
   * persisted with most columns null, so the row reflects "not sold here".
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
    const rows = persistable.map((s) => {
      const metadata = { ...(s.metadata ?? {}), found: s.found };
      return {
        ean: s.ean,
        origin: s.origin,
        name: s.name ?? null,
        price: s.price ?? null,
        supplier: s.supplier ?? null,
        brand: s.brand ?? null,
        sku: s.sku ?? null,
        weight: s.weight ?? null,
        height: s.height ?? null,
        length: s.length ?? null,
        width: s.width ?? null,
        metadata,
      };
    });
    await repo.upsert(rows, {
      conflictPaths: ['ean', 'origin'],
      indexPredicate: 'deleted_at IS NULL',
      skipUpdateIfNoValuesChanged: true,
    });
  }
}
