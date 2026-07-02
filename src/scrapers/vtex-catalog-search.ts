import { HttpService } from '@nestjs/axios';
import { Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { ScrapedProduct } from './types';

export const VTEX_CATALOG_HEADERS = {
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

export const VTEX_CATALOG_TIMEOUT_MS = 30_000;

export interface VtexCatalogItem {
  ean?: string;
  images?: Array<{ imageUrl?: string }>;
  sellers?: Array<{
    commertialOffer?: {
      Price?: number;
      PromotionTeasers?: Array<{ Name?: string }>;
    };
  }>;
  referenceId?: Array<{ Key?: string; Value?: string }>;
}

export interface VtexCatalogProduct {
  productName?: string;
  brand?: string;
  productReferenceCode?: string;
  description?: string;
  items?: VtexCatalogItem[];
}

export function buildMultiEanSearchUrl(
  catalogSearchBase: string,
  eans: string[],
): string {
  const qs = eans
    .map((ean) => `fq=alternateIds_Ean:${encodeURIComponent(ean)}`)
    .join('&');
  // VTEX defaults to 10 hits; multi-EAN needs an explicit range.
  const range = eans.length > 1 ? `&_from=0&_to=${eans.length - 1}` : '';
  return `${catalogSearchBase}?${qs}${range}`;
}

function eansFromProduct(product: VtexCatalogProduct): string[] {
  const out: string[] = [];
  for (const item of product.items ?? []) {
    if (item.ean) out.push(String(item.ean));
    for (const ref of item.referenceId ?? []) {
      if (ref.Key === 'EAN' && ref.Value) out.push(ref.Value);
    }
  }
  return out;
}

export function mapVtexProductsToScrapes<T extends VtexCatalogProduct>(
  requestedEans: string[],
  products: T[],
  origin: CompetitorOrigin,
  mapProduct: (ean: string, product: T) => ScrapedProduct,
): ScrapedProduct[] {
  const eanToProduct = new Map<string, T>();
  for (const product of products) {
    const productEans = eansFromProduct(product);
    for (const ean of productEans) {
      if (!eanToProduct.has(ean)) eanToProduct.set(ean, product);
    }
  }

  if (
    requestedEans.length === 1 &&
    products.length === 1 &&
    !eanToProduct.has(requestedEans[0])
  ) {
    return [mapProduct(requestedEans[0], products[0])];
  }

  return requestedEans.map((ean) => {
    const product = eanToProduct.get(ean);
    if (!product) return { ean, origin, found: false };
    return mapProduct(ean, product);
  });
}

export async function fetchVtexCatalogProducts<T extends VtexCatalogProduct>(
  http: HttpService,
  catalogSearchBase: string,
  eans: string[],
): Promise<T[]> {
  const url = buildMultiEanSearchUrl(catalogSearchBase, eans);
  const { data } = await http.axiosRef.get<T[]>(url, {
    headers: VTEX_CATALOG_HEADERS,
    timeout: VTEX_CATALOG_TIMEOUT_MS,
  });
  return data ?? [];
}

export async function scrapeVtexCatalogProducts<T extends VtexCatalogProduct>(
  http: HttpService,
  catalogSearchBase: string,
  eans: string[],
  origin: CompetitorOrigin,
  mapProduct: (ean: string, product: T) => ScrapedProduct,
  logger: Logger,
  label: string,
): Promise<ScrapedProduct[]> {
  if (eans.length === 0) return [];
  try {
    const products = await fetchVtexCatalogProducts<T>(
      http,
      catalogSearchBase,
      eans,
    );
    return mapVtexProductsToScrapes(eans, products, origin, mapProduct);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${label} scrapeProducts failed: ${message}`);
    return eans.map((ean) => ({
      ean,
      origin,
      found: false,
      error: message,
    }));
  }
}
