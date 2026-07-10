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
  price?: string | null;
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

export interface ProductScraper {
  readonly origin: CompetitorOrigin;
  scrapeProduct(ean: string): Promise<ScrapedProduct>;
  scrapeProducts(eans: string[]): Promise<ScrapedProduct[]>;
}

export async function scrapeProductsSequential(
  scraper: ProductScraper,
  eans: string[],
): Promise<ScrapedProduct[]> {
  const scrapes: ScrapedProduct[] = [];
  for (const ean of eans) {
    scrapes.push(await scraper.scrapeProduct(ean));
  }
  return scrapes;
}

export function toNumericString(
  value: number | null | undefined,
): string | null {
  if (value == null) return null;
  return Number.isFinite(value) ? String(value) : null;
}

export function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]*>/g, '').trim() || undefined;
}
