import { EntityManager } from 'typeorm';
import { ProductStockEntity } from '../../entities/shared-catalog/product-stock.entity';
import { ProductEntity } from '../../entities/shared-catalog/product.entity';
import type { ScrapedStock } from '../../../scrapers/types';

/**
 * shared_catalog.product_stock writer. Each scrape produces one row
 * per (product_id, captured_at) so historical stock is preserved —
 * a fresh `captured_at` per run rather than overwriting.
 *
 * The scraper returns ScrapedStock keyed by (ean, origin); this
 * resolves to product_id with one SELECT (ean+origin -> id) and
 * inserts in bulk.
 */
export class ProductStockRepository {
  constructor(private readonly em: EntityManager) {}

  public async insertSnapshots(scrapes: ScrapedStock[]): Promise<void> {
    if (scrapes.length === 0) return;
    const productRepo = this.em.getRepository(ProductEntity);
    const stockRepo = this.em.getRepository(ProductStockEntity);

    const byEanOrigin = new Map<string, ScrapedStock>();
    for (const s of scrapes) byEanOrigin.set(`${s.ean}|${s.origin}`, s);

    const eans = scrapes.map((s) => s.ean);
    const origins = [...new Set(scrapes.map((s) => s.origin))];
    const products: Array<{ id: string; ean: string; origin: string }> =
      await productRepo
        .createQueryBuilder('p')
        .select(['p.id AS id', 'p.ean AS ean', 'p.origin AS origin'])
        .where('p.ean = ANY(:eans::bigint[])', { eans })
        .andWhere('p.origin IN (:...origins)', { origins })
        .getRawMany();

    const rows = products
      .map((p) => {
        const scrape = byEanOrigin.get(`${String(p.ean)}|${p.origin}`);
        if (!scrape) return null;
        return {
          productId: p.id,
          quantity: scrape.quantity,
          capturedAt: scrape.capturedAt,
        };
      })
      .filter(
        (r): r is { productId: string; quantity: number; capturedAt: Date } =>
          r !== null,
      );

    if (rows.length === 0) return;
    await stockRepo.insert(rows);
  }
}
