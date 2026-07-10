import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { scrapeVtexCatalogProducts } from '../vtex-catalog-search';

const CATALOG_SEARCH_BASE =
  'https://www.drogariaspacheco.com.br/api/catalog_system/pub/products/search';

@Injectable()
export class PachecoScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.PACHECO;
  private readonly logger = new Logger(PachecoScraper.name);

  constructor(private readonly http: HttpService) {}

  public scrapeProduct(ean: string): Promise<ScrapedProduct> {
    return this.scrapeProducts([ean]).then((rows) => rows[0]);
  }

  public scrapeProducts(eans: string[]): Promise<ScrapedProduct[]> {
    return scrapeVtexCatalogProducts(
      this.http,
      CATALOG_SEARCH_BASE,
      eans,
      this.origin,
      this.logger,
    );
  }
}
