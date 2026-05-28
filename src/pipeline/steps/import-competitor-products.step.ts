import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import { DrogalScraper } from '../../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../../scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../../scrapers/michelassi/michelassi.scraper';
import { ProductScraper, ScrapedProduct } from '../../scrapers/types';

/**
 * Per-batch scrape for ONE origin's slice of EANs. The batch consumer
 * hands us (origin, eans); we route to the right scraper, scrape
 * sequentially (broker prefetch is the only concurrency knob — no
 * in-process parallelism), and upsert the results in one bulk write.
 *
 * Errors from individual EANs are captured into the ScrapedProduct
 * (found:false + error message) and persisted, so a failed scrape
 * becomes a row in shared_catalog.product with metadata.error rather
 * than crashing the batch.
 */
@Injectable()
export class ImportCompetitorProductsStep {
  private readonly logger = new Logger(ImportCompetitorProductsStep.name);

  constructor(
    private readonly drogal: DrogalScraper,
    private readonly drogasil: DrogasilScraper,
    private readonly michelassi: MichelassiScraper,
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
    const found = scrapes.filter((s) => s.found).length;
    this.logger.debug(
      `import-competitor-products[${origin}]: ${eans.length} scraped, ${found} found`,
    );
  }

  private scraperFor(origin: CompetitorOrigin): ProductScraper {
    switch (origin) {
      case CompetitorOrigin.DROGAL:
        return this.drogal;
      case CompetitorOrigin.DROGASIL:
        return this.drogasil;
      case CompetitorOrigin.MICHELASSI:
        return this.michelassi;
      default:
        throw new Error(`No product scraper registered for origin ${origin}`);
    }
  }
}
