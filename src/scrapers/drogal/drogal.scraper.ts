import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import {
  ProductScraper,
  ScrapedProduct,
  ScrapedStock,
  StockScraper,
} from '../types';
import {
  DrogalCustomData,
  DrogalMeasures,
  DrogalProduct,
  DrogalStockResponse,
  DrogalVariationsResponse,
} from './types';

const BASE_URL = 'https://www.drogal.com.br';
const STOCK_SUBSIDIARY_IDS = [113, 310] as const;

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
 * Drogal scraper: hits three VTEX endpoints — catalog_system for
 * product metadata, variations for measures, drogalCheckout for stock.
 *
 * Returns ScrapedProduct / ScrapedStock; the step is responsible for
 * persistence. PBM detection ports the legacy logic verbatim:
 * CustomData.pbmPrice overrides Price when present.
 */
@Injectable()
export class DrogalScraper implements ProductScraper, StockScraper {
  public readonly origin = CompetitorOrigin.DROGAL;
  private readonly logger = new Logger(DrogalScraper.name);

  constructor(private readonly http: HttpService) {}

  public async scrapeProduct(ean: string): Promise<ScrapedProduct> {
    try {
      const product = await this.fetchProductByEan(ean);
      if (!product) return { ean, origin: this.origin, found: false };
      const measures = product.productId
        ? await this.fetchMeasures(product.productId)
        : undefined;
      return this.mapProduct(ean, product, measures);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`scrapeProduct ean=${ean} failed: ${message}`);
      return { ean, origin: this.origin, found: false, error: message };
    }
  }

  public async scrapeStock(
    items: Array<{ ean: string; sku: string }>,
  ): Promise<ScrapedStock[]> {
    if (items.length === 0) return [];
    const capturedAt = new Date();
    const payload = {
      type: 'getPickupPointsByItems',
      params: {
        items: items.map((i) => ({ productRefId: i.sku, quantity: '1' })),
      },
    };
    try {
      const { data } = await this.http.axiosRef.post<DrogalStockResponse>(
        `${BASE_URL}/_v/drogalCheckout`,
        payload,
        { headers: HEADERS, timeout: TIMEOUT_MS },
      );
      return items.map((i) => ({
        ean: i.ean,
        origin: this.origin,
        quantity: sumStockForSku(data, i.sku),
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

  private async fetchProductByEan(ean: string): Promise<DrogalProduct | null> {
    const url = `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}`;
    const { data } = await this.http.axiosRef.get<DrogalProduct[]>(url, {
      headers: HEADERS,
      timeout: TIMEOUT_MS,
    });
    return data?.length ? data[0] : null;
  }

  private async fetchMeasures(
    productId: string,
  ): Promise<DrogalMeasures | undefined> {
    try {
      const url = `${BASE_URL}/api/catalog_system/pub/products/variations/${productId}`;
      const { data } = await this.http.axiosRef.get<DrogalVariationsResponse>(
        url,
        {
          headers: HEADERS,
          timeout: TIMEOUT_MS,
        },
      );
      return data?.skus?.[0]?.measures;
    } catch (err) {
      this.logger.warn(
        `fetchMeasures productId=${productId} failed: ${err instanceof Error ? err.message : err}`,
      );
      return undefined;
    }
  }

  private mapProduct(
    ean: string,
    product: DrogalProduct,
    measures: DrogalMeasures | undefined,
  ): ScrapedProduct {
    const offer = product.items?.[0]?.sellers?.[0]?.commertialOffer;
    if (!offer) return { ean, origin: this.origin, found: false };
    const { isPbm, pbmPrice, van } = detectPbm(product);
    const price = isPbm && pbmPrice > 0 ? pbmPrice : offer.Price;
    return {
      ean,
      origin: this.origin,
      found: true,
      name: product.productName ?? null,
      brand: product.brand ?? null,
      sku: product.productReferenceCode ?? null,
      price: toNumericString(price),
      weight: toNumericString(measures?.weight),
      height: toNumericString(measures?.height),
      length: toNumericString(measures?.length),
      width: toNumericString(measures?.width),
      metadata: {
        description: stripHtml(product.description),
        image: product.items?.[0]?.images?.[0]?.imageUrl,
        observation: offer.PromotionTeasers?.[0]?.Name,
        cubicWeight: measures?.cubicweight,
        isPbm,
        van,
      },
    };
  }
}

export function detectPbm(product: DrogalProduct): {
  isPbm: boolean;
  pbmPrice: number;
  van: string | null;
} {
  const van = product.VAN?.[0] ?? null;
  for (const raw of product.CustomData ?? []) {
    try {
      const parsed = JSON.parse(raw) as DrogalCustomData;
      if (parsed.pbmPrice && parsed.pbmPrice > 0) {
        return { isPbm: true, pbmPrice: parsed.pbmPrice / 100, van };
      }
    } catch {
      // skip non-JSON entries
    }
  }
  return { isPbm: (product.PBM?.length ?? 0) > 0, pbmPrice: 0, van };
}

export function sumStockForSku(
  data: DrogalStockResponse | undefined,
  sku: string,
): number {
  if (!data?.body?.pickupPointItems?.length) return 0;
  const skuNum = Number(sku);
  let total = 0;
  for (const subsidiaryId of STOCK_SUBSIDIARY_IDS) {
    const point = data.body.pickupPointItems.find(
      (p) => p.CodigoFilial === subsidiaryId,
    );
    const item = point?.CartDetail?.find((c) => c.productRefId === skuNum);
    if (item?.avaliable && item.quantityAvaliable)
      total += item.quantityAvaliable;
  }
  return total;
}

function toNumericString(value: number | null | undefined): string | null {
  if (value == null) return null;
  return Number.isFinite(value) ? String(value) : null;
}

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>/g, '').trim() || undefined;
}
