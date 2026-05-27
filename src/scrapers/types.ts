import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';

/**
 * Shape returned by a per-origin scraper after fetching one EAN's
 * product page. Maps 1:1 onto `shared_catalog.product` columns +
 * jsonb `metadata` for origin-specific extras.
 *
 * `found: false` means the scraper succeeded but the EAN does not
 * exist on this origin's catalog — distinct from `error`, which
 * means the scrape itself failed.
 */
export interface ScrapedProduct {
  ean: string;
  origin: CompetitorOrigin;
  found: boolean;
  name?: string | null;
  url?: string | null;
  price?: string | null;
  unitSalePrice?: string | null;
  supplier?: string | null;
  brand?: string | null;
  sku?: string | null;
  weight?: string | null;
  height?: string | null;
  length?: string | null;
  width?: string | null;
  metadata?: Record<string, unknown>;
  error?: string | null;
}

/**
 * Per-product stock snapshot. Multiple subsidiaries are summed into
 * `quantity` so the cross-origin product_stock table stays a flat
 * single-quantity row per (product_id, captured_at).
 */
export interface ScrapedStock {
  ean: string;
  origin: CompetitorOrigin;
  quantity: number;
  capturedAt: Date;
  error?: string | null;
}

export interface ProductScraper {
  readonly origin: CompetitorOrigin;
  scrapeProduct(ean: string): Promise<ScrapedProduct>;
}

export interface StockScraper {
  readonly origin: CompetitorOrigin;
  /**
   * Stock fetched by SKU lookup, not by EAN, because most vendor
   * stock APIs key on their internal SKU. The caller resolves
   * (ean -> sku) from a previous product scrape.
   */
  scrapeStock(items: Array<{ ean: string; sku: string }>): Promise<ScrapedStock[]>;
}
