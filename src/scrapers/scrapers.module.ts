import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DrogalScraper } from './drogal/drogal.scraper';

/**
 * Per-origin scrapers (Phase C). Each scraper implements
 * ProductScraper and/or StockScraper from ./types. Steps inject the
 * concrete scraper they need; no shared base class — each origin's
 * API differs enough that abstraction would obscure more than help.
 */
@Module({
  imports: [HttpModule.register({ timeout: 30_000, maxRedirects: 5 })],
  providers: [DrogalScraper],
  exports: [DrogalScraper],
})
export class ScrapersModule {}
