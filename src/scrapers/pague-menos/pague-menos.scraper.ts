import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { scrapeVtexCatalogProducts } from '../vtex-catalog-search';
import { PagueMenosProduct } from './types';

const CATALOG_SEARCH_BASE =
  'https://www.paguemenos.com.br/api/catalog_system/pub/products/search';

/**
 * Pague Menos scraper — VTEX catalog_system, single search-by-EAN call
 * (port of legacy pague-menos.service.ts).
 */
@Injectable()
export class PagueMenosScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.PAGUE_MENOS;
  private readonly logger = new Logger(PagueMenosScraper.name);

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
      'PagueMenosScraper',
    );
  }
}

export function mapProduct(ean: string, p: PagueMenosProduct): ScrapedProduct {
  const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
  if (!offer)
    return { ean, origin: CompetitorOrigin.PAGUE_MENOS, found: false };
  return {
    ean,
    origin: CompetitorOrigin.PAGUE_MENOS,
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
