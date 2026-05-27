import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductStockRepository } from '../../database/repositories/shared-catalog/product-stock.repository';
import { DrogalScraper } from '../../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../../scrapers/drogasil/drogasil.scraper';
import { StockScraper } from '../../scrapers/types';

/**
 * Per-batch stock scrape for ONE origin. The batch carries
 * { origin, items: [{ ean, sku }] }; we pick the right scraper, do
 * one API call (most vendors take an array of SKUs), and insert
 * snapshots into shared_catalog.product_stock.
 *
 * Michelassi is products-only (stock arrives with the product fetch),
 * so it's not handled here.
 */
@Injectable()
export class ImportCompetitorStockStep {
  private readonly logger = new Logger(ImportCompetitorStockStep.name);

  constructor(
    private readonly drogal: DrogalScraper,
    private readonly drogasil: DrogasilScraper,
  ) {}

  public async run(
    em: EntityManager,
    origin: CompetitorOrigin,
    items: Array<{ ean: string; sku: string }>,
  ): Promise<void> {
    if (items.length === 0) return;
    const scraper = this.scraperFor(origin);
    const stocks = await scraper.scrapeStock(items);
    await new ProductStockRepository(em).insertSnapshots(stocks);
    this.logger.debug(
      `import-competitor-stock[${origin}]: ${stocks.length} snapshots inserted`,
    );
  }

  private scraperFor(origin: CompetitorOrigin): StockScraper {
    switch (origin) {
      case CompetitorOrigin.DROGAL:
        return this.drogal;
      case CompetitorOrigin.DROGASIL:
        return this.drogasil;
      default:
        throw new Error(
          `No stock scraper registered for origin ${origin}`,
        );
    }
  }
}
