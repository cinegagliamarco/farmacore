import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import { ProductStockRepository } from '../../database/repositories/shared-catalog/product-stock.repository';
import { DrogalScraper } from '../../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../../scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../../scrapers/michelassi/michelassi.scraper';
import { PagueMenosScraper } from '../../scrapers/pague-menos/pague-menos.scraper';
import { IkesakiScraper } from '../../scrapers/ikesaki/ikesaki.scraper';
import {
  ProductScraper,
  ScrapedProduct,
  StockScraper,
} from '../../scrapers/types';
import { CompetitorImageService } from '../../storage/competitor-image.service';

/**
 * Per-batch scrape for ONE origin's slice of EANs. For each EAN we do
 * the whole unit of work inline — scrape the product, then its stock
 * (for origins with a stock API), then re-host its image — and persist
 * all three. Stock is no longer a separate downstream step waiting on
 * every origin to finish; it lands as each product is imported.
 *
 * Errors from individual EANs are captured into the ScrapedProduct
 * (found:false + error message) and persisted; stock/image failures are
 * non-fatal (the scraper/uploader swallow them), so a bad EAN becomes a
 * row rather than crashing the batch.
 */
@Injectable()
export class ImportCompetitorProductsStep {
  private readonly logger = new Logger(ImportCompetitorProductsStep.name);

  constructor(
    private readonly drogal: DrogalScraper,
    private readonly drogasil: DrogasilScraper,
    private readonly michelassi: MichelassiScraper,
    private readonly pagueMenos: PagueMenosScraper,
    private readonly ikesaki: IkesakiScraper,
    private readonly images: CompetitorImageService,
  ) {}

  public async run(
    em: EntityManager,
    origin: CompetitorOrigin,
    eans: string[],
  ): Promise<void> {
    if (eans.length === 0) return;
    const scraper = this.scraperFor(origin);
    const scrapes: ScrapedProduct[] = [];
    for (const ean of eans) {
      scrapes.push(await scraper.scrapeProduct(ean));
    }
    await new SharedProductRepository(em).upsertScrapes(scrapes);
    await this.importStock(em, origin, scrapes);
    await this.images.project(em, scrapes);
    const found = scrapes.filter((s) => s.found).length;
    this.logger.debug(
      `import-competitor-products[${origin}]: ${eans.length} scraped, ${found} found`,
    );
  }

  /** Scrape + persist stock for the same EANs, for origins that expose a
   *  stock API (Drogal, Drogasil). Keyed by the sku from the product
   *  scrape; origins without a stock scraper (Michelassi/Pague Menos/
   *  Ikesaki) carry availability inline on the product instead. */
  private async importStock(
    em: EntityManager,
    origin: CompetitorOrigin,
    scrapes: ScrapedProduct[],
  ): Promise<void> {
    const stockScraper = this.stockScraperFor(origin);
    if (!stockScraper) return;
    const items = scrapes
      .filter((s) => s.found && s.sku)
      .map((s) => ({ ean: s.ean, sku: s.sku as string }));
    if (items.length === 0) return;
    const stocks = await stockScraper.scrapeStock(items);
    await new ProductStockRepository(em).insertSnapshots(stocks);
  }

  private scraperFor(origin: CompetitorOrigin): ProductScraper {
    switch (origin) {
      case CompetitorOrigin.DROGAL:
        return this.drogal;
      case CompetitorOrigin.DROGASIL:
        return this.drogasil;
      case CompetitorOrigin.MICHELASSI:
        return this.michelassi;
      case CompetitorOrigin.PAGUE_MENOS:
        return this.pagueMenos;
      case CompetitorOrigin.IKESAKI:
        return this.ikesaki;
      default:
        throw new Error(
          `No product scraper registered for origin ${String(origin)}`,
        );
    }
  }

  private stockScraperFor(origin: CompetitorOrigin): StockScraper | null {
    if (origin === CompetitorOrigin.DROGAL) return this.drogal;
    if (origin === CompetitorOrigin.DROGASIL) return this.drogasil;
    return null;
  }
}
