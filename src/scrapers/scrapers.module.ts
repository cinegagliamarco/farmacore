import { HttpModule, HttpService } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DrogalScraper } from './drogal/drogal.scraper';
import { DrogasilScraper } from './drogasil/drogasil.scraper';
import { MichelassiScraper } from './michelassi/michelassi.scraper';
import { PagueMenosScraper } from './pague-menos/pague-menos.scraper';
import { IkesakiScraper } from './ikesaki/ikesaki.scraper';
import { PachecoScraper } from './pacheco/pacheco.scraper';
import { SaoPauloScraper } from './sao-paulo/sao-paulo.scraper';
import { VenancioScraper } from './venancio/venancio.scraper';
import { IndianaScraper } from './indiana/indiana.scraper';
import { configureScraperRetry } from './http-retry';

const SCRAPER_HTTP_RETRY = 'SCRAPER_HTTP_RETRY';

/**
 * Per-origin scrapers (Phase C). Each scraper implements
 * ProductScraper from ./types. Steps inject the
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
    PachecoScraper,
    SaoPauloScraper,
    VenancioScraper,
    IndianaScraper,
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
    PachecoScraper,
    SaoPauloScraper,
    VenancioScraper,
    IndianaScraper,
  ],
})
export class ScrapersModule {}
