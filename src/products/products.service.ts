import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { BaseProductEntity } from '../database/entities/shared-catalog/base-product.entity';
import { BaseProductRepository } from '../database/repositories/shared-catalog/base-product.repository';
import { ProductStockRepository } from '../database/repositories/shared-catalog/product-stock.repository';
import { SharedProductRepository } from '../database/repositories/shared-catalog/product.repository';
import { DrogalScraper } from '../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../scrapers/michelassi/michelassi.scraper';
import type {
  ProductScraper,
  ScrapedProduct,
  ScrapedStock,
  StockScraper,
} from '../scrapers/types';
import { CompetitorImageService } from '../storage/competitor-image.service';

export interface ProductOriginView {
  origin: CompetitorOrigin;
  found: boolean;
  name: string | null;
  price: string | null;
  unitSalePrice: string | null;
  brand: string | null;
  sku: string | null;
  url: string | null;
  weight: string | null;
  height: string | null;
  length: string | null;
  width: string | null;
  image: string | null;
  images: string[];
  description: string | null;
  observation: string | null;
  isPbm: boolean;
  van: string | null;
  stock: number | null;
  error: string | null;
}

export interface ProductDetailsView {
  ean: string;
  baseProduct: {
    ean: string;
    description: string | null;
    activeIngredient: string | null;
    generic: boolean;
    weight: string | null;
    height: string | null;
    length: string | null;
    width: string | null;
  } | null;
  origins: ProductOriginView[];
}

export interface ProductExportQuery {
  origin?: CompetitorOrigin;
  limit: number;
  offset: number;
}

export interface ProductExportRow {
  ean: string;
  origin: CompetitorOrigin;
  name: string | null;
  price: string | null;
  unitSalePrice: string | null;
  supplier: string | null;
  brand: string | null;
  sku: string | null;
  url: string | null;
  image: string | null;
  stock: number | null;
  stockCapturedAt: string | null;
}

export interface ProductExportResult {
  total: number;
  limit: number;
  offset: number;
  items: ProductExportRow[];
}

/**
 * Single-product live import: scrapes every competitor origin for one
 * EAN, persists the results into shared_catalog (product, product_image,
 * product_stock, base_product), and returns the merged cross-origin view.
 *
 * Port of legacy GetSingleProductUseCase. Touches shared_catalog only —
 * no tenant tables — so it runs off the default DataSource (the entities
 * carry their own `schema`, so no search_path is needed).
 */
@Injectable()
export class ProductsService {
  private readonly productScrapers: ProductScraper[];

  constructor(
    private readonly drogal: DrogalScraper,
    private readonly drogasil: DrogasilScraper,
    private readonly michelassi: MichelassiScraper,
    private readonly images: CompetitorImageService,
    private readonly dataSource: DataSource,
  ) {
    this.productScrapers = [drogal, drogasil, michelassi];
  }

  /** Bulk export of the shared competitor catalog: each product row with
   *  its primary image and latest stock snapshot, optionally filtered by
   *  origin, paginated. Shared-catalog only — no tenant data. */
  public async export(q: ProductExportQuery): Promise<ProductExportResult> {
    const origin = q.origin ?? null;
    const countRows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT count(*)::int AS count FROM shared_catalog.product p
        WHERE ($1::text IS NULL OR p.origin = $1)`,
      [origin],
    );
    const rows: Array<{
      ean: string;
      origin: CompetitorOrigin;
      name: string | null;
      price: string | null;
      unitSalePrice: string | null;
      supplier: string | null;
      brand: string | null;
      sku: string | null;
      url: string | null;
      image: string | null;
      stock: number | null;
      stockCapturedAt: Date | null;
    }> = await this.dataSource.query(
      `SELECT p.ean, p.origin, p.name, p.price,
              p.unit_sale_price AS "unitSalePrice",
              p.supplier, p.brand, p.sku, p.url,
              img.url AS image,
              st.quantity AS stock, st.captured_at AS "stockCapturedAt"
         FROM shared_catalog.product p
         LEFT JOIN LATERAL (
           SELECT url FROM shared_catalog.product_image
            WHERE product_id = p.id AND is_primary IS TRUE
            ORDER BY created_at DESC LIMIT 1
         ) img ON true
         LEFT JOIN LATERAL (
           SELECT quantity, captured_at FROM shared_catalog.product_stock
            WHERE product_id = p.id ORDER BY captured_at DESC LIMIT 1
         ) st ON true
        WHERE ($1::text IS NULL OR p.origin = $1)
        ORDER BY p.ean, p.origin
        LIMIT $2 OFFSET $3`,
      [origin, q.limit, q.offset],
    );
    return {
      total: countRows[0]?.count ?? 0,
      limit: q.limit,
      offset: q.offset,
      items: rows.map((r) => ({
        ean: String(r.ean),
        origin: r.origin,
        name: r.name ?? null,
        price: r.price ?? null,
        unitSalePrice: r.unitSalePrice ?? null,
        supplier: r.supplier ?? null,
        brand: r.brand ?? null,
        sku: r.sku ?? null,
        url: r.url ?? null,
        image: r.image ?? null,
        stock: r.stock ?? null,
        stockCapturedAt: r.stockCapturedAt
          ? new Date(r.stockCapturedAt).toISOString()
          : null,
      })),
    };
  }

  public async importProduct(ean: string): Promise<ProductDetailsView> {
    const scrapes = await Promise.all(
      this.productScrapers.map((s) => s.scrapeProduct(ean)),
    );
    const stocks = await this.scrapeStocks(ean, scrapes);

    return this.dataSource.transaction(async (em) => {
      await new SharedProductRepository(em).upsertScrapes(scrapes);
      await new BaseProductRepository(em).insertNewByEan([{ ean }]);
      await new ProductStockRepository(em).insertSnapshots(stocks);
      await this.images.project(em, scrapes);

      const baseProduct = await em
        .getRepository(BaseProductEntity)
        .findOne({ where: { ean } });

      return this.merge(ean, baseProduct, scrapes, stocks);
    });
  }

  /** Drogal/Drogasil expose a stock API (keyed by sku); Michelassi
   *  returns stock inline on the product scrape (metadata.stockBalance). */
  private async scrapeStocks(
    ean: string,
    scrapes: ScrapedProduct[],
  ): Promise<ScrapedStock[]> {
    const capturedAt = new Date();
    const stocks: ScrapedStock[] = [];
    await Promise.all(
      scrapes.map(async (sc) => {
        if (!sc.found) return;
        if (sc.origin === CompetitorOrigin.MICHELASSI) {
          stocks.push({
            ean,
            origin: sc.origin,
            quantity: Number(sc.metadata?.stockBalance ?? 0),
            capturedAt,
          });
          return;
        }
        const scraper = this.stockScraperFor(sc.origin);
        if (!scraper || !sc.sku) return;
        const [stock] = await scraper.scrapeStock([{ ean, sku: sc.sku }]);
        if (stock) stocks.push(stock);
      }),
    );
    return stocks;
  }

  private stockScraperFor(origin: CompetitorOrigin): StockScraper | null {
    if (origin === CompetitorOrigin.DROGAL) return this.drogal;
    if (origin === CompetitorOrigin.DROGASIL) return this.drogasil;
    return null;
  }

  private merge(
    ean: string,
    baseProduct: BaseProductEntity | null,
    scrapes: ScrapedProduct[],
    stocks: ScrapedStock[],
  ): ProductDetailsView {
    const stockByOrigin = new Map(stocks.map((s) => [s.origin, s.quantity]));
    return {
      ean,
      baseProduct: baseProduct
        ? {
            ean: baseProduct.ean,
            description: baseProduct.description ?? null,
            activeIngredient: baseProduct.activeIngredient ?? null,
            generic: baseProduct.generic,
            weight: baseProduct.weight ?? null,
            height: baseProduct.height ?? null,
            length: baseProduct.length ?? null,
            width: baseProduct.width ?? null,
          }
        : null,
      origins: scrapes.map((s) => {
        const image = (s.metadata?.image as string | undefined) ?? null;
        return {
          origin: s.origin,
          found: s.found,
          name: s.name ?? null,
          price: s.price ?? null,
          unitSalePrice: s.unitSalePrice ?? null,
          brand: s.brand ?? null,
          sku: s.sku ?? null,
          url: s.url ?? null,
          weight: s.weight ?? null,
          height: s.height ?? null,
          length: s.length ?? null,
          width: s.width ?? null,
          image,
          images: image ? [image] : [],
          description: (s.metadata?.description as string | undefined) ?? null,
          observation: (s.metadata?.observation as string | undefined) ?? null,
          isPbm: Boolean(s.metadata?.isPbm),
          van: (s.metadata?.van as string | undefined) ?? null,
          stock: stockByOrigin.get(s.origin) ?? null,
          error: s.error ?? null,
        };
      }),
    };
  }
}
