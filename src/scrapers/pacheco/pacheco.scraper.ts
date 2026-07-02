import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { scrapeVtexCatalogProducts } from '../vtex-catalog-search';
import { PachecoProduct } from './types';

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
      mapProduct,
      this.logger,
      'PachecoScraper',
    );
  }
}

export function mapProduct(ean: string, p: PachecoProduct): ScrapedProduct {
  const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
  if (!offer) return { ean, origin: CompetitorOrigin.PACHECO, found: false };
  return {
    ean,
    origin: CompetitorOrigin.PACHECO,
    found: true,
    name: p.productName ?? null,
    brand: p.brand ?? null,
    sku:
      p.productReferenceCode ??
      p.items?.[0]?.referenceId?.find((r) => r.Key === 'RefId')?.Value ??
      null,
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
