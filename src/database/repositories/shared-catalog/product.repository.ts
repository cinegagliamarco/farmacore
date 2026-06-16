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
   * Bulk upsert scraped competitor products by (ean, origin). Pass
   * `found: false` records too — they get persisted with most columns
   * null and metadata.error set, so the next run can see "we tried,
   * not on this origin's catalog" and skip / retry per policy.
   */
  public async upsertScrapes(scrapes: ScrapedProduct[]): Promise<void> {
    if (scrapes.length === 0) return;
    const repo = this.em.getRepository(ProductEntity);
    const rows = scrapes.map((s) => {
      const baseMetadata = s.metadata ?? {};
      const metadata = s.error
        ? { ...baseMetadata, error: s.error, found: s.found }
        : { ...baseMetadata, found: s.found };
      return {
        ean: s.ean,
        origin: s.origin,
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
        metadata,
      };
    });
    await repo.upsert(rows, {
      conflictPaths: ['ean', 'origin'],
      indexPredicate: 'deleted_at IS NULL',
      skipUpdateIfNoValuesChanged: true,
    });
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
