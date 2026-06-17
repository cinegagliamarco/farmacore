import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DrogalScraper } from './drogal/drogal.scraper';
import { DrogasilScraper } from './drogasil/drogasil.scraper';
import { MichelassiScraper } from './michelassi/michelassi.scraper';
import { PagueMenosScraper } from './pague-menos/pague-menos.scraper';

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
  ],
  exports: [
    DrogalScraper,
    DrogasilScraper,
    MichelassiScraper,
    PagueMenosScraper,
  ],
})
export class ScrapersModule {}
