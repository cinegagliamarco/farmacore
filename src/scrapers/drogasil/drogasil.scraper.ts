import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { ProductScraper, ScrapedProduct } from '../types';
import {
  DrogasilCustomAttribute,
  DrogasilProductBySku,
  DrogasilProductResponse,
} from './types';

const SEARCH_URL = (ean: string) =>
  `https://www.drogasil.com.br/search?w=${ean}&facets=filters.Vendido+por%3ADrogasil&p=1`;
const GRAPHQL_PRODUCT_URL =
  'https://www.drogaraia.com.br/api/next/middlewareGraphql';
const SKU_PATTERN = /<article[^>]*data-item-id="([^"]+)"[^>]*>/;
const TIMEOUT_MS = 30_000;
const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const BUFFER_TAIL_BYTES = 50 * 1024;

// The storefront search page sits behind Akamai bot-manager, which 403s
// requests by their TLS fingerprint: axios (node:https) is blocked even
// with a browser User-Agent, while undici (global `fetch`) passes. So every
// request here goes through `fetch`, not the axios-based HttpService — search
// would otherwise return no SKU and no price would ever populate.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

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
  'user-agent': USER_AGENT,
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

/**
 * Drogasil scraper. Two-step product fetch:
 *  1. Search page HTML — stream-parsed for `data-item-id="SKU"` so the
 *     5MB response doesn't blow up memory.
 *  2. GraphQL `productBySku` (hosted under drogaraia.com.br) for the
 *     full product metadata.
 */
@Injectable()
export class DrogasilScraper implements ProductScraper {
  public readonly origin = CompetitorOrigin.DROGASIL;
  private readonly logger = new Logger(DrogasilScraper.name);

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

  /**
   * Stream-parse the search page HTML for the first
   * `<article data-item-id="SKU">` and abort the stream as soon as it
   * hits. Memory-bounded: 5MB content cap + 50KB sliding window over
   * the buffer. Returns null only when the page genuinely has no match;
   * throws on transport failure (non-2xx, timeout, network) so the caller
   * records an `error` and the row is skipped instead of overwriting the
   * last-good price with null.
   */
  private async streamFindSku(ean: string): Promise<string | null> {
    const res = await fetch(SEARCH_URL(ean), {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`search HTTP ${res.status}`);
    if (!res.body) return null;
    return consumeForPattern(res.body, SKU_PATTERN, MAX_CONTENT_BYTES);
  }

  private async fetchProductBySku(
    sku: string,
  ): Promise<DrogasilProductBySku | null> {
    const res = await fetch(GRAPHQL_PRODUCT_URL, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: JSON.stringify({ query: PRODUCT_QUERY, variables: { sku } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`product HTTP ${res.status}`);
    const data = (await res.json()) as DrogasilProductResponse;
    if (data?.errors) return null;
    return data?.data?.productBySku ?? null;
  }
}

/**
 * Read the search-page body chunk by chunk, stopping at the first
 * `data-item-id="SKU"` so the 5MB response never fully buffers. Bounded by
 * a byte cap plus a 50KB sliding window. Cancels the stream on exit.
 */
export async function consumeForPattern(
  body: ReadableStream<Uint8Array>,
  pattern: RegExp,
  maxBytes: number,
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return null;
      totalBytes += value.length;
      if (totalBytes > maxBytes) return null;
      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(pattern);
      if (match) return match[1] ?? match[0];
      if (buffer.length > BUFFER_TAIL_BYTES) {
        buffer = buffer.slice(-BUFFER_TAIL_BYTES);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
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
