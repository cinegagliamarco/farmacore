import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct, scrapeProductsSequential } from '../types';
import { MichelassiProduct, MichelassiSearchResponse } from './types';

const SEARCH_URL = (ean: string) =>
  `https://api.instabuy.com.br/apiv3/search?subdomain=supermercadomichelassi&search=${ean}&page=1&N=30`;
const IMAGE_URL = (id: string) =>
  `https://ibassets.com.br/ib.item.image.large/l-${id}.jpeg`;

const HEADERS = {
  accept: '*/*',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  origin: 'https://supermercadomichelassi.instabuy.com.br',
  pragma: 'no-cache',
  referer: 'https://supermercadomichelassi.instabuy.com.br/',
  'sec-ch-ua':
    '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
} as const;

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2_000;

/**
 * Michelassi scraper (instabuy.com.br). Single endpoint returns the
 * full product metadata.
 *
 * Rate-limit handling: 429 retries up to 3 times with exponential
 * backoff (2s, 4s, 8s) — matches legacy behavior.
 */
@Injectable()
export class MichelassiScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.MICHELASSI;
  private readonly logger = new Logger(MichelassiScraper.name);

  constructor(private readonly http: HttpService) {}

  public async scrapeProduct(ean: string): Promise<ScrapedProduct> {
    try {
      const product = await this.fetchProductByEan(ean, 0);
      if (!product) return { ean, origin: this.origin, found: false };
      return mapProduct(ean, product);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`scrapeProduct ean=${ean} failed: ${message}`);
      return { ean, origin: this.origin, found: false, error: message };
    }
  }

  public scrapeProducts(eans: string[]): Promise<ScrapedProduct[]> {
    return scrapeProductsSequential(this, eans);
  }

  private async fetchProductByEan(
    ean: string,
    attempt: number,
  ): Promise<MichelassiProduct | null> {
    try {
      const { data } = await this.http.axiosRef.get<MichelassiSearchResponse>(
        SEARCH_URL(ean),
        { headers: HEADERS, timeout: TIMEOUT_MS },
      );
      return data?.data?.[0] ?? null;
    } catch (err) {
      if (isRateLimited(err) && attempt < MAX_RETRIES) {
        const backoff = BASE_BACKOFF_MS * 2 ** attempt;
        this.logger.warn(
          `429 for ean=${ean}, retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await delay(backoff);
        return this.fetchProductByEan(ean, attempt + 1);
      }
      throw err;
    }
  }
}

export function mapProduct(ean: string, p: MichelassiProduct): ScrapedProduct {
  return {
    ean,
    origin: CompetitorOrigin.MICHELASSI,
    found: true,
    name: p.name ?? null,
    brand: p.brand ?? null,
    sku: p.erp_internal_code ?? null,
    price: toNumericString(p.min_price_valid),
    metadata: {
      description: p.description,
      image: p.images?.[0] ? IMAGE_URL(p.images[0]) : undefined,
    },
  };
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 429;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumericString(value: number | null | undefined): string | null {
  if (value == null) return null;
  return Number.isFinite(value) ? String(value) : null;
}
