import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { scrapeVtexCatalogProducts } from '../vtex-catalog-search';
import { IkesakiProduct } from './types';

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
      mapProduct,
      this.logger,
      'IkesakiScraper',
    );
  }
}

export function mapProduct(ean: string, p: IkesakiProduct): ScrapedProduct {
  const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
  if (!offer) return { ean, origin: CompetitorOrigin.IKESAKI, found: false };
  return {
    ean,
    origin: CompetitorOrigin.IKESAKI,
    found: true,
    name: p.productName ?? null,
    brand: p.brand ?? null,
    sku: p.productReferenceCode ?? null,
    price: toNumericString(offer.Price),
    metadata: {
      description: stripHtml(p.description),
      image: p.items?.[0]?.images?.[0]?.imageUrl,
      observation: offer.PromotionTeasers?.[0]?.Name,
    },
  };
}

function toNumericString(value: number | null | undefined): string | null {
  if (value == null) return null;
  return Number.isFinite(value) ? String(value) : null;
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>/g, '').trim() || undefined;
}
