import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import { PipelineMetricsRegistry } from '../../observability/pipeline-metrics.registry';
import { DrogalScraper } from '../../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../../scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../../scrapers/michelassi/michelassi.scraper';
import { PagueMenosScraper } from '../../scrapers/pague-menos/pague-menos.scraper';
import { IkesakiScraper } from '../../scrapers/ikesaki/ikesaki.scraper';
import { PachecoScraper } from '../../scrapers/pacheco/pacheco.scraper';
import { SaoPauloScraper } from '../../scrapers/sao-paulo/sao-paulo.scraper';
import { VenancioScraper } from '../../scrapers/venancio/venancio.scraper';
import { IndianaScraper } from '../../scrapers/indiana/indiana.scraper';
import { ProductScraper } from '../../scrapers/types';
import { CompetitorImageService } from '../../storage/competitor-image.service';

/**
 * Per-batch scrape for ONE origin's slice of EANs. For each EAN we
 * scrape the product, persist it, then re-host its image.
 *
 * Errors from individual EANs are captured into the ScrapedProduct
 * (found:false + error message) and persisted; image failures are
 * non-fatal (the uploader swallows them), so a bad EAN becomes a row
 * rather than crashing the batch.
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
    private readonly pacheco: PachecoScraper,
    private readonly saoPaulo: SaoPauloScraper,
    private readonly venancio: VenancioScraper,
    private readonly indiana: IndianaScraper,
    private readonly images: CompetitorImageService,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  public async run(
    em: EntityManager,
    tenantId: string,
    origin: CompetitorOrigin,
    eans: string[],
  ): Promise<void> {
    if (eans.length === 0) return;
    const repo = new SharedProductRepository(em);
    // Skip EANs already known absent from this origin's catalog (found=false):
    // re-scraping them is mostly wasted work (findNotFoundEans still re-checks
    // a random sample so it isn't forever). The skip lives here, not in the
    // dispatcher, so the dispatched batch plan stays deterministic across
    // restarts (the fan-in counter depends on it).
    const notFound = await repo.findNotFoundEans(origin, eans);
    const toScrape = notFound.size
      ? eans.filter((ean) => !notFound.has(ean))
      : eans;
    if (toScrape.length === 0) return;
    const scraper = this.scraperFor(origin);
    const scrapes = await scraper.scrapeProducts(toScrape);
    await repo.upsertScrapes(scrapes);
    await this.images.project(em, scrapes);
    const found = scrapes.filter((s) => s.found).length;
    const errors = scrapes.filter((s) => s.error).length;
    this.metrics.onScrapeBatch(
      tenantId,
      origin,
      toScrape.length,
      found,
      errors,
    );
    this.logger.debug(
      `import-competitor-products[${origin}]: ${toScrape.length} scraped, ${found} found`,
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
      case CompetitorOrigin.PAGUE_MENOS:
        return this.pagueMenos;
      case CompetitorOrigin.IKESAKI:
        return this.ikesaki;
      case CompetitorOrigin.PACHECO:
        return this.pacheco;
      case CompetitorOrigin.SAO_PAULO:
        return this.saoPaulo;
      case CompetitorOrigin.VENANCIO:
        return this.venancio;
      case CompetitorOrigin.INDIANA:
        return this.indiana;
      default:
        throw new Error(
          `No product scraper registered for origin ${String(origin)}`,
        );
    }
  }
}
