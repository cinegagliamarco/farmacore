import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import type { AxiosResponse } from 'axios';
import type { Readable } from 'node:stream';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import {
  ProductScraper,
  ScrapedProduct,
  ScrapedStock,
  StockScraper,
} from '../types';
import {
  DrogasilCustomAttribute,
  DrogasilProductBySku,
  DrogasilProductResponse,
  DrogasilStockResponse,
} from './types';

const SEARCH_URL = (ean: string) =>
  `https://www.drogasil.com.br/search?w=${ean}&facets=filters.Vendido+por%3ADrogasil&p=1`;
const GRAPHQL_PRODUCT_URL =
  'https://www.drogaraia.com.br/api/next/middlewareGraphql';
const GRAPHQL_STOCK_URL =
  'https://www.drogasil.com.br/api/next/cesta-checkout/graphql';
const SKU_PATTERN = /<article[^>]*data-item-id="([^"]+)"[^>]*>/;
const TIMEOUT_MS = 30_000;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const BUFFER_TAIL_BYTES = 50 * 1024;
const DEFAULT_ZIPCODE = '17250075';

const COMMON_HEADERS = {
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

const STOCK_HEADERS = {
  accept: '*/*',
  'accept-language': 'pt-BR,pt;q=0.9',
  'content-type': 'application/json',
  origin: 'https://www.drogasil.com.br',
  referer: 'https://www.drogasil.com.br/checkout/cart',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
} as const;

const PRODUCT_QUERY = `query getProduct($sku: String!) {
  productBySku(sku: $sku) {
    id sku name price weight
    price_aux { value_to lmpm_value_to lmpm_qty }
    media_gallery_entries { file }
    pbm { products { sku EAN percentDiscountPbm valueSalePbm } }
    liveComposition { livePrice { valueTo type } }
    custom_attributes { attribute_code value_string value { id label } }
  }
}`;

const STOCK_QUERY = `query GET_STOCK($zipcode: String!, $products: [StockNearbyBtZipCodeTypeInput!]!, $logotype: String!, $maxQuantityBranchSearch: String) {
  getNearbyStockByZipCode(products: $products, zipcode: $zipcode, logotype: $logotype, maxQuantityBranchSearch: $maxQuantityBranchSearch) {
    stocks { sku quantity }
  }
}`;

export interface DrogasilStockOptions {
  zipcode?: string;
}

/**
 * Drogasil scraper. Two-step product fetch:
 *  1. Search page HTML — stream-parsed for `data-item-id="SKU"` so the
 *     5MB response doesn't blow up memory.
 *  2. GraphQL `productBySku` (hosted under drogaraia.com.br) for the
 *     full product metadata.
 *
 * Stock comes from a separate GraphQL `getNearbyStockByZipCode`; the
 * zipcode is per-tenant config in the new model (defaults to the
 * legacy hardcoded value when not provided).
 */
@Injectable()
export class DrogasilScraper implements ProductScraper, StockScraper {
  public readonly origin = CompetitorOrigin.DROGASIL;
  private readonly logger = new Logger(DrogasilScraper.name);

  constructor(private readonly http: HttpService) {}

  public async scrapeProduct(ean: string): Promise<ScrapedProduct> {
    try {
      const sku = await this.streamFindSku(ean);
      if (!sku) return { ean, origin: this.origin, found: false };
      const product = await this.fetchProductBySku(sku);
      if (!product) return { ean, origin: this.origin, found: false };
      return mapProduct(ean, product);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`scrapeProduct ean=${ean} failed: ${message}`);
      return { ean, origin: this.origin, found: false, error: message };
    }
  }

  public async scrapeStock(
    items: Array<{ ean: string; sku: string }>,
    options: DrogasilStockOptions = {},
  ): Promise<ScrapedStock[]> {
    if (items.length === 0) return [];
    const capturedAt = new Date();
    const zipcode = options.zipcode ?? DEFAULT_ZIPCODE;
    try {
      const { data } = await this.http.axiosRef.post<DrogasilStockResponse>(
        GRAPHQL_STOCK_URL,
        {
          query: STOCK_QUERY,
          variables: {
            zipcode,
            products: items.map((i) => ({ sku: i.sku })),
            logotype: 'RD',
            maxQuantityBranchSearch: '1',
          },
        },
        { headers: STOCK_HEADERS, timeout: TIMEOUT_MS },
      );
      const bySku = buildStockMap(data);
      return items.map((i) => ({
        ean: i.ean,
        origin: this.origin,
        quantity: bySku.get(i.sku) ?? 0,
        capturedAt,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `scrapeStock for ${items.length} SKUs failed: ${message}`,
      );
      return items.map((i) => ({
        ean: i.ean,
        origin: this.origin,
        quantity: 0,
        capturedAt,
        error: message,
      }));
    }
  }

  /**
   * Stream-parse the search page HTML for the first
   * `<article data-item-id="SKU">` and abort the stream as soon as it
   * hits. Memory-bounded: 5MB content cap + 50KB sliding window over
   * the buffer. Returns null on timeout / no match / network error.
   */
  private async streamFindSku(ean: string): Promise<string | null> {
    try {
      const response: AxiosResponse = await this.http.axiosRef.get(
        SEARCH_URL(ean),
        {
          responseType: 'stream',
          timeout: TIMEOUT_MS,
          maxContentLength: MAX_CONTENT_BYTES,
        },
      );
      return await consumeForPattern(response, SKU_PATTERN, MAX_CONTENT_BYTES);
    } catch (err) {
      this.logger.warn(
        `streamFindSku ean=${ean} failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  private async fetchProductBySku(
    sku: string,
  ): Promise<DrogasilProductBySku | null> {
    const { data } = await this.http.axiosRef.post<DrogasilProductResponse>(
      GRAPHQL_PRODUCT_URL,
      { query: PRODUCT_QUERY, variables: { sku } },
      { headers: COMMON_HEADERS, timeout: TIMEOUT_MS },
    );
    if (data?.errors) return null;
    return data?.data?.productBySku ?? null;
  }
}

function consumeForPattern(
  response: AxiosResponse,
  pattern: RegExp,
  maxBytes: number,
): Promise<string | null> {
  // Axios types response.data as `any` for stream responses. We asked
  // for responseType: 'stream', so it's a node Readable in practice.
  const stream = response.data as Readable;
  return new Promise((resolve, reject) => {
    let buffer = '';
    let totalBytes = 0;
    let done = false;

    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      stream.destroy();
      resolve(value);
    };

    stream.on('data', (chunk: Buffer) => {
      if (done) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) return finish(null);
      buffer += chunk.toString();
      const match = buffer.match(pattern);
      if (match) return finish(match[1] ?? match[0]);
      if (buffer.length > BUFFER_TAIL_BYTES) {
        buffer = buffer.slice(-BUFFER_TAIL_BYTES);
      }
    });
    stream.on('end', () => finish(null));
    stream.on('error', reject);
  });
}

export function mapProduct(
  ean: string,
  p: DrogasilProductBySku,
): ScrapedProduct {
  const attrs = p.custom_attributes ?? [];
  const description = stripHtml(
    joinValueStrings(attrFor(attrs, 'description')),
  );
  const category = joinValueStrings(attrFor(attrs, 'grupo'));
  const brand = labelOf(attrFor(attrs, 'marca'));
  const supplier = labelOf(attrFor(attrs, 'fabricante'));

  const priceAux = p.price_aux;
  const basePrice = priceAux?.value_to ?? p.price;
  const observation =
    priceAux?.lmpm_value_to && priceAux.lmpm_qty
      ? `Leve ${priceAux.lmpm_qty} unidades por R$ ${String(priceAux.lmpm_value_to).replace('.', ',')} cada`
      : undefined;

  const { isPbm, pbmPrice } = detectPbm(p);
  const finalPrice = isPbm && pbmPrice > 0 ? pbmPrice : basePrice;

  return {
    ean,
    origin: CompetitorOrigin.DROGASIL,
    found: true,
    name: p.name ?? null,
    brand,
    supplier,
    sku: p.sku ?? null,
    price: toNumericString(finalPrice),
    weight: toNumericString(p.weight),
    metadata: {
      description,
      category,
      image: p.media_gallery_entries?.[0]?.file,
      observation,
      isPbm,
    },
  };
}

export function detectPbm(p: DrogasilProductBySku): {
  isPbm: boolean;
  pbmPrice: number;
} {
  const livePrice = p.liveComposition?.livePrice;
  if (livePrice?.type === 'PBM') {
    return { isPbm: true, pbmPrice: livePrice.valueTo ?? 0 };
  }
  for (const pbm of p.pbm ?? []) {
    for (const item of pbm.products ?? []) {
      if ((item.percentDiscountPbm ?? 0) > 0 || (item.valueSalePbm ?? 0) > 0) {
        return { isPbm: true, pbmPrice: item.valueSalePbm ?? 0 };
      }
    }
  }
  return { isPbm: false, pbmPrice: 0 };
}

export function buildStockMap(
  data: DrogasilStockResponse | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!data?.data || data.errors) return out;
  const first = data.data.getNearbyStockByZipCode?.[0];
  for (const s of first?.stocks ?? []) {
    if (s.sku != null) out.set(String(s.sku), s.quantity ?? 0);
  }
  return out;
}

function attrFor(
  attrs: DrogasilCustomAttribute[],
  code: string,
): DrogasilCustomAttribute | undefined {
  return attrs.find((a) => a.attribute_code === code);
}

function joinValueStrings(
  attr: DrogasilCustomAttribute | undefined,
): string | undefined {
  if (!attr?.value_string?.length) return undefined;
  const joined = attr.value_string.join(' ').trim();
  return joined || undefined;
}

function labelOf(attr: DrogasilCustomAttribute | undefined): string | null {
  return attr?.value?.[0]?.label ?? null;
}

function toNumericString(value: number | null | undefined): string | null {
  if (value == null) return null;
  return Number.isFinite(value) ? String(value) : null;
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>/g, '').trim() || undefined;
}
