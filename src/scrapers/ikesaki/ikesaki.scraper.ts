import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { scrapeVtexCatalogProducts } from '../vtex-catalog-search';

const CATALOG_SEARCH_BASE =
  'https://www.ikesaki.com.br/api/catalog_system/pub/products/search';

@Injectable()
export class IkesakiScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.IKESAKI;
  private readonly logger = new Logger(IkesakiScraper.name);

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
