import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { BaseProductEntity } from '../database/entities/shared-catalog/base-product.entity';
import { ProductEntity } from '../database/entities/shared-catalog/product.entity';
import { ProductImageEntity } from '../database/entities/shared-catalog/product-image.entity';
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
    private readonly dataSource: DataSource,
  ) {
    this.productScrapers = [drogal, drogasil, michelassi];
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
      await this.persistImages(em, ean, scrapes);

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

  /** Refresh product_image for the scraped origins: each scraper yields a
   *  single primary image in metadata.image. Delete-then-insert keeps the
   *  table in sync with the latest scrape rather than piling duplicates. */
  private async persistImages(
    em: EntityManager,
    ean: string,
    scrapes: ScrapedProduct[],
  ): Promise<void> {
    const withImage = scrapes.filter((s) => s.found && s.metadata?.image);
    if (withImage.length === 0) return;

    const rows: Array<{ id: string; origin: string }> = await em
      .getRepository(ProductEntity)
      .createQueryBuilder('p')
      .select(['p.id AS id', 'p.origin AS origin'])
      .where('p.ean = :ean', { ean })
      .andWhere('p.origin IN (:...origins)', {
        origins: withImage.map((s) => s.origin),
      })
      .getRawMany();
    const idByOrigin = new Map(rows.map((r) => [r.origin, r.id]));

    const imageRepo = em.getRepository(ProductImageEntity);
    await imageRepo.delete({ productId: In([...idByOrigin.values()]) });
    const images = withImage
      .filter((s) => idByOrigin.has(s.origin))
      .map((s) => ({
        productId: idByOrigin.get(s.origin) as string,
        url: String(s.metadata?.image),
        isPrimary: true,
      }));
    if (images.length > 0) await imageRepo.insert(images);
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
