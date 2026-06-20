import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import { IndianaProduct } from './types';

const SEARCH_URL = (ean: string) =>
  `https://www.farmaciaindiana.com.br/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  accept: '*/*',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'sec-ch-ua':
    '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
} as const;

const TIMEOUT_MS = 30_000;

/**
 * Farmácia Indiana scraper — VTEX catalog_system, single search-by-EAN
 * call. Products-only: availability is the inline `IsAvailable` boolean
 * (kept in metadata), so there's no separate stock step for this origin.
 */
@Injectable()
export class IndianaScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.INDIANA;
  private readonly logger = new Logger(IndianaScraper.name);

  constructor(private readonly http: HttpService) {}

  public async scrapeProduct(ean: string): Promise<ScrapedProduct> {
    try {
      const { data } = await this.http.axiosRef.get<IndianaProduct[]>(
        SEARCH_URL(ean),
        { headers: HEADERS, timeout: TIMEOUT_MS },
      );
      const product = data?.length ? data[0] : null;
      if (!product) return { ean, origin: this.origin, found: false };
      return mapProduct(ean, product);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`scrapeProduct ean=${ean} failed: ${message}`);
      return { ean, origin: this.origin, found: false, error: message };
    }
  }
}

export function mapProduct(ean: string, p: IndianaProduct): ScrapedProduct {
  const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer;
  if (!offer) return { ean, origin: CompetitorOrigin.INDIANA, found: false };
  return {
    ean,
    origin: CompetitorOrigin.INDIANA,
    found: true,
    name: p.productName ?? null,
    brand: p.brand ?? null,
    sku: p.productReferenceCode ?? null,
    price: toNumericString(offer.Price),
    metadata: {
      description: stripHtml(p.description),
      image: p.items?.[0]?.images?.[0]?.imageUrl,
      observation: offer.PromotionTeasers?.[0]?.Name,
      availableStock: offer.IsAvailable ?? false,
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
