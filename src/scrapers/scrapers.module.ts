import { HttpModule, HttpService } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DrogalScraper } from './drogal/drogal.scraper';
import { DrogasilScraper } from './drogasil/drogasil.scraper';
import { MichelassiScraper } from './michelassi/michelassi.scraper';
import { PagueMenosScraper } from './pague-menos/pague-menos.scraper';
import { IkesakiScraper } from './ikesaki/ikesaki.scraper';
import { configureScraperRetry } from './http-retry';

const SCRAPER_HTTP_RETRY = 'SCRAPER_HTTP_RETRY';

/**
 * Per-origin scrapers (Phase C). Each scraper implements
 * ProductScraper and/or StockScraper from ./types. Steps inject the
 * concrete scraper they need; no shared base class — each origin's
 * API differs enough that abstraction would obscure more than help.
 */
@Module({
  imports: [HttpModule.register({ timeout: 30_000, maxRedirects: 5 })],
  providers: [
    DrogalScraper,
    DrogasilScraper,
    MichelassiScraper,
    PagueMenosScraper,
    IkesakiScraper,
    {
      provide: SCRAPER_HTTP_RETRY,
      useFactory: (http: HttpService): boolean => {
        configureScraperRetry(http);
        return true;
      },
      inject: [HttpService],
    },
  ],
  exports: [
    DrogalScraper,
    DrogasilScraper,
    MichelassiScraper,
    PagueMenosScraper,
    IkesakiScraper,
  ],
})
export class ScrapersModule {}
