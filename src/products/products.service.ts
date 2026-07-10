import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { BaseProductEntity } from '../database/entities/shared-catalog/base-product.entity';
import { BaseProductRepository } from '../database/repositories/shared-catalog/base-product.repository';
import { SharedProductRepository } from '../database/repositories/shared-catalog/product.repository';
import { DrogalScraper } from '../scrapers/drogal/drogal.scraper';
import { DrogasilScraper } from '../scrapers/drogasil/drogasil.scraper';
import { MichelassiScraper } from '../scrapers/michelassi/michelassi.scraper';
import { PagueMenosScraper } from '../scrapers/pague-menos/pague-menos.scraper';
import { IkesakiScraper } from '../scrapers/ikesaki/ikesaki.scraper';
import { PachecoScraper } from '../scrapers/pacheco/pacheco.scraper';
import { SaoPauloScraper } from '../scrapers/sao-paulo/sao-paulo.scraper';
import { VenancioScraper } from '../scrapers/venancio/venancio.scraper';
import { IndianaScraper } from '../scrapers/indiana/indiana.scraper';
import type { ProductScraper, ScrapedProduct } from '../scrapers/types';
import { CompetitorImageService } from '../storage/competitor-image.service';

interface ProductOriginView {
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

interface ProductExportRow {
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
 * base_product), and returns the merged cross-origin view.
 *
 * Port of legacy GetSingleProductUseCase. Touches shared_catalog only —
 * no tenant tables — so it runs off the default DataSource (the entities
 * carry their own `schema`, so no search_path is needed).
 */
@Injectable()
export class ProductsService {
  private readonly productScrapers: ProductScraper[];

  constructor(
    drogal: DrogalScraper,
    drogasil: DrogasilScraper,
    michelassi: MichelassiScraper,
    pagueMenos: PagueMenosScraper,
    ikesaki: IkesakiScraper,
    pacheco: PachecoScraper,
    saoPaulo: SaoPauloScraper,
    venancio: VenancioScraper,
    indiana: IndianaScraper,
    private readonly images: CompetitorImageService,
    private readonly dataSource: DataSource,
  ) {
    this.productScrapers = [
      drogal,
      drogasil,
      michelassi,
      pagueMenos,
      ikesaki,
      pacheco,
      saoPaulo,
      venancio,
      indiana,
    ];
  }

  /** Bulk export of the shared competitor catalog: each product row with
   *  its primary image, optionally filtered by origin, paginated.
   *  Shared-catalog only — no tenant data. */
  public async export(q: ProductExportQuery): Promise<ProductExportResult> {
    const origin = q.origin ?? null;
    const [countRows, rows] = await Promise.all([
      this.dataSource.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM shared_catalog.product p
          WHERE ($1::text IS NULL OR p.origin = $1)`,
        [origin],
      ),
      // unit_sale_price and url are FE-contract fields that are always NULL
      // (no scraper ever wrote them).
      this.dataSource.query<ProductExportRow[]>(
        `SELECT p.ean, p.origin, p.name, p.price,
                  p.unit_sale_price AS "unitSalePrice",
                  p.supplier, p.brand, p.sku, p.url,
                  img.url AS image
             FROM shared_catalog.product p
             LEFT JOIN LATERAL (
               SELECT url FROM shared_catalog.product_image
                WHERE product_id = p.id AND is_primary IS TRUE
                ORDER BY created_at DESC LIMIT 1
             ) img ON true
            WHERE ($1::text IS NULL OR p.origin = $1)
            ORDER BY p.ean, p.origin
            LIMIT $2 OFFSET $3`,
        [origin, q.limit, q.offset],
      ),
    ]);
    return {
      total: countRows[0]?.count ?? 0,
      limit: q.limit,
      offset: q.offset,
      items: rows.map((r) => ({ ...r, ean: String(r.ean) })),
    };
  }

  public async importProduct(ean: string): Promise<ProductDetailsView> {
    const scrapes = await Promise.all(
      this.productScrapers.map((s) => s.scrapeProduct(ean)),
    );

    return this.dataSource.transaction(async (em) => {
      await new SharedProductRepository(em).upsertScrapes(scrapes);
      await new BaseProductRepository(em).insertNewByEan([{ ean }]);
      await this.images.project(em, scrapes);

      const baseProduct = await em
        .getRepository(BaseProductEntity)
        .findOne({ where: { ean } });

      return this.merge(ean, baseProduct, scrapes);
    });
  }

  private merge(
    ean: string,
    baseProduct: BaseProductEntity | null,
    scrapes: ScrapedProduct[],
  ): ProductDetailsView {
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
          // No scraper populates unitSalePrice or url; kept null for the
          // FE contract.
          unitSalePrice: null,
          brand: s.brand ?? null,
          sku: s.sku ?? null,
          url: null,
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
          error: s.error ?? null,
        };
      }),
    };
  }
}
