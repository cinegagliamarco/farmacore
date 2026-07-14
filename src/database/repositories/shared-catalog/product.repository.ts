import { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ProductEntity } from '../../entities/shared-catalog/product.entity';
import type { ScrapedProduct } from '../../../scrapers/types';

// Fraction of already-not-found EANs re-checked each run so a not-found
// decision isn't permanent: a competitor that later starts selling the
// product (or a bad 200-empty sweep during their downtime) is rediscovered
// within a few weeks instead of never. At ~10% per daily run the expected
// re-check is ~10 days; the other ~90% stay skipped, keeping the win.
const NOT_FOUND_RECHECK_SAMPLE = 0.1;

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
   * "not sold here" and the daily import skips it on later runs (re-checking
   * a random sample so it isn't blacklisted forever).
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
    // Cast needed: TypeORM's QueryDeepPartialEntity rejects a bare
    // Record<string, unknown> jsonb value unless the literal carries a
    // concrete key — which metadata no longer does now that `found` is a
    // column instead of a metadata key.
    const rows = persistable.map((s) => ({
      ean: s.ean,
      origin: s.origin,
      found: s.found,
      name: s.name ?? null,
      price: s.price ?? null,
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
   * Of the given EANs, the subset already known not to be sold on `origin`
   * (found = false) that the batch scrape should skip. A random
   * NOT_FOUND_RECHECK_SAMPLE slice is deliberately left OUT of the skip set
   * each run so not-found EANs are periodically re-scraped instead of
   * blacklisted forever. Scoped to the batch's EANs so the (ean, origin)
   * index serves it instead of a full-table scan.
   */
  public async findNotFoundEans(
    origin: string,
    eans: string[],
  ): Promise<Set<string>> {
    if (eans.length === 0) return new Set();
    const rows: Array<{ ean: string }> = await this.em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select('p.ean', 'ean')
      .where('p.origin = :origin', { origin })
      .andWhere('p.found = false')
      .andWhere('p.ean = ANY(:eans::bigint[])', { eans })
      .andWhere('random() >= :recheck', { recheck: NOT_FOUND_RECHECK_SAMPLE })
      .getRawMany();
    return new Set(rows.map((r) => String(r.ean)));
  }
}
