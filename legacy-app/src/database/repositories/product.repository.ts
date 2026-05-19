import { Injectable } from '@nestjs/common';
import { IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { Origin } from '../../common/origin.enum';
import { ProductTypeormEntity } from '../entities/product.entity';

export interface ProductExportRow {
  id: number;
  ean: number;
  name: string;
  curve?: string;
  book?: string;
  price: number;
  description?: string;
  average_unit_cost?: number;
  unit_sale_price?: number;

  drogal_name?: string;
  drogasil_name?: string;
  pague_menos_name?: string;
  ikesaki_name?: string;
  michelassi_name?: string;

  drogasil_category?: string;

  drogasil_weight?: number;

  drogal_price?: number;
  drogasil_price?: number;
  pague_menos_price?: number;
  ikesaki_price?: number;
  michelassi_price?: number;

  drogal_observation?: string;
  drogasil_observation?: string;
  pague_menos_observation?: string;
  ikesaki_observation?: string;

  drogal_error?: string;
  drogasil_error?: string;
  pague_menos_error?: string;
  ikesaki_error?: string;
  michelassi_error?: string;

  drogal_subsidiary_one_stock?: string;
  drogasil_subsidiary_one_stock?: string;
  michelassi_subsidiary_one_stock?: string;

  drogal_subsidiary_two_stock?: string;

  drogal_main_image?: string;
  drogasil_main_image?: string;
  pague_menos_main_image?: string;
  ikesaki_main_image?: string;
  michelassi_main_image?: string;

  drogal_images?: string;
  drogasil_images?: string;
  pague_menos_images?: string;
  ikesaki_images?: string;

  base_product_images?: string;
}

const dayMath = 24 * 60 * 60 * 1000;
const ONE_DAY_AGO = new Date(Date.now() - 1 * dayMath);
const TWO_DAYS_ONE_DAY_AGOAGO = new Date(Date.now() - 2 * dayMath);

@Injectable()
export class ProductRepository {
  constructor(private readonly repository: Repository<ProductTypeormEntity>) {}

  public async findByEanAndOrigin(ean: number, origin: Origin): Promise<ProductTypeormEntity | undefined> {
    return this.repository.findOne({ where: { ean, origin } });
  }

  public async findByOrigin(origin: Origin): Promise<ProductTypeormEntity[]> {
    return this.repository.find({ where: { origin } });
  }

  public findUpdatedByOrigin(origin: Origin): Promise<ProductTypeormEntity[]> {
    return this.repository.find({ where: { origin, updatedDate: MoreThan(ONE_DAY_AGO) } });
  }

  public async save(product: ProductTypeormEntity): Promise<ProductTypeormEntity> {
    if (!product.id) {
      const existingProduct = await this.findByEanAndOrigin(product.ean, product.origin);
      if (existingProduct) product.id = existingProduct.id; // Update the product if it already exists
    }

    product.updatedDate = new Date(); // Force the updated date for products that were not changed

    return this.repository.save(product);
  }

  public async findWithoutStockByOrigin(origin: Origin): Promise<ProductTypeormEntity[]> {
    return this.repository
      .createQueryBuilder('product')
      .innerJoin('base_product', 'bp', 'bp.ean = product.ean')
      .leftJoin('product_stock', 'ps', 'ps.product_id = product.id')
      .where('product.origin = :origin', { origin })
      .andWhere('product.exists = TRUE')
      .andWhere('ps.id IS NULL')
      .getMany();
  }

  public findProductsToExport(): Promise<ProductExportRow[]> {
    const query = `
      SELECT
        bp.ean,
        bp.name,
        bp.curve,
        bp.book,
        bp.price,
        bp.description,
        bp.average_unit_cost,
        bp.unit_sale_price,

        MAX(p.name) FILTER (WHERE p.origin = '${Origin.DROGAL}') AS drogal_name,
        MAX(p.name) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_name,
        MAX(p.name) FILTER (WHERE p.origin = '${Origin.PAGUE_MENOS}') AS pague_menos_name,
        MAX(p.name) FILTER (WHERE p.origin = '${Origin.IKESAKI}') AS ikesaki_name,
        MAX(p.name) FILTER (WHERE p.origin = '${Origin.MICHELASSI}') AS michelassi_name,

        MAX(p.price) FILTER (WHERE p.origin = '${Origin.DROGAL}') AS drogal_price,
        MAX(p.price) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_price,
        MAX(p.price) FILTER (WHERE p.origin = '${Origin.PAGUE_MENOS}') AS pague_menos_price,
        MAX(p.price) FILTER (WHERE p.origin = '${Origin.IKESAKI}') AS ikesaki_price,
        MAX(p.price) FILTER (WHERE p.origin = '${Origin.MICHELASSI}') AS michelassi_price,

        MAX(p.category) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_category,

        MAX(p.weight) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_weight,

        MAX(p.observation) FILTER (WHERE p.origin = '${Origin.DROGAL}') AS drogal_observation,
        MAX(p.observation) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_observation,
        MAX(p.observation) FILTER (WHERE p.origin = '${Origin.PAGUE_MENOS}') AS pague_menos_observation,
        MAX(p.observation) FILTER (WHERE p.origin = '${Origin.IKESAKI}') AS ikesaki_observation,

        MAX(p.error) FILTER (WHERE p.origin = '${Origin.DROGAL}') AS drogal_error,
        MAX(p.error) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_error,
        MAX(p.error) FILTER (WHERE p.origin = '${Origin.PAGUE_MENOS}') AS pague_menos_error,
        MAX(p.error) FILTER (WHERE p.origin = '${Origin.IKESAKI}') AS ikesaki_error,
        MAX(p.error) FILTER (WHERE p.origin = '${Origin.MICHELASSI}') AS michelassi_error,

        MAX(ps_drogal.subsidiary_one_stock) AS drogal_subsidiary_one_stock,
        MAX(ps_drogasil.subsidiary_one_stock) AS drogasil_subsidiary_one_stock,
        MAX(ps_michelassi.subsidiary_one_stock) AS michelassi_subsidiary_one_stock,

        MAX(ps_drogal.subsidiary_two_stock) AS drogal_subsidiary_two_stock,

        MAX(p.image) FILTER (WHERE p.origin = '${Origin.DROGAL}') AS drogal_main_image,
        MAX(p.image) FILTER (WHERE p.origin = '${Origin.DROGASIL}') AS drogasil_main_image,
        MAX(p.image) FILTER (WHERE p.origin = '${Origin.PAGUE_MENOS}') AS pague_menos_main_image,
        MAX(p.image) FILTER (WHERE p.origin = '${Origin.IKESAKI}') AS ikesaki_main_image,
        MAX(p.image) FILTER (WHERE p.origin = '${Origin.MICHELASSI}') AS michelassi_main_image,

        STRING_AGG(DISTINCT pi_drogal.url, ', ') AS drogal_images,
        STRING_AGG(DISTINCT pi_drogasil.url, ', ') AS drogasil_images,
        STRING_AGG(DISTINCT pi_pague_menos.url, ', ') AS pague_menos_images,
        STRING_AGG(DISTINCT pi_ikesaki.url, ', ') AS ikesaki_images,

        STRING_AGG(DISTINCT bpi.url, ', ') AS base_product_images

      FROM base_product bp

      LEFT JOIN product p ON p.ean = bp.ean

      LEFT JOIN product_stock ps_drogal ON ps_drogal.product_id = p.id AND p.origin = '${Origin.DROGAL}'
      LEFT JOIN product_stock ps_drogasil ON ps_drogasil.product_id = p.id AND p.origin = '${Origin.DROGASIL}'
      LEFT JOIN product_stock ps_michelassi ON ps_michelassi.product_id = p.id AND p.origin = '${Origin.MICHELASSI}'

      LEFT JOIN product_image pi_drogal ON pi_drogal.product_id = p.id AND p.origin = '${Origin.DROGAL}'
      LEFT JOIN product_image pi_drogasil ON pi_drogasil.product_id = p.id AND p.origin = '${Origin.DROGASIL}'
      LEFT JOIN product_image pi_pague_menos ON pi_pague_menos.product_id = p.id AND p.origin = '${Origin.PAGUE_MENOS}'
      LEFT JOIN product_image pi_ikesaki ON pi_ikesaki.product_id = p.id AND p.origin = '${Origin.IKESAKI}'

      LEFT JOIN base_product_image bpi ON bpi.base_product_id = bp.id

      WHERE p.exists = TRUE
      GROUP BY bp.ean, bp.name, bp.curve, bp.book, bp.price, bp.average_unit_cost, bp.description, bp.unit_sale_price
    `;

    return this.repository.query(query);
  }

  public async setProductToOutdated(ean: number, origin: Origin): Promise<void> {
    await this.repository.update({ ean, origin }, { updatedDate: TWO_DAYS_ONE_DAY_AGOAGO });
  }

  public async saveProductError(ean: number, origin: Origin, errorMessage: string): Promise<void> {
    const existingProduct = await this.findByEanAndOrigin(ean, origin);
    if (existingProduct) {
      existingProduct.error = errorMessage;
      await this.repository.save(existingProduct);
      return;
    }

    const product = new ProductTypeormEntity();
    product.ean = ean;
    product.origin = origin;
    product.error = errorMessage;
    await this.repository.save(product);
  }

  public async findProductsWithErrorsOrOutdated(origin: Origin): Promise<[ProductTypeormEntity[], number]> {
    return this.repository.findAndCount({
      where: [
        { origin, error: Not(IsNull()) },
        { origin, updatedDate: LessThan(ONE_DAY_AGO) }
      ],
      order: { updatedDate: 'ASC' },
      take: 100
    });
  }

  public findProductsWithStockErrorsOrOutdated(origin: Origin): Promise<[ProductTypeormEntity[], number]> {
    return this.repository.findAndCount({
      where: [
        { origin, stock: { error: Not(IsNull()) } },
        { origin, stock: { updatedDate: LessThan(ONE_DAY_AGO) } }
      ],
      order: { updatedDate: 'ASC' },
      take: 100
    });
  }

  public async getMinPricesByEans(eans: number[]): Promise<Map<string, number>> {
    if (eans.length === 0) return new Map();

    const result = await this.repository
      .createQueryBuilder('product')
      .select('product.ean', 'ean')
      .addSelect('MIN(product.price)', 'minPrice')
      .where('product.ean IN (:...eans)', { eans })
      .andWhere('product.price > 0')
      .groupBy('product.ean')
      .getRawMany();

    const map = new Map<string, number>();
    for (const row of result) {
      map.set(row.ean, Number(row.minPrice));
    }
    return map;
  }

  public async getPricesByEansAndOrigins(eans: number[], origins: Origin[]): Promise<Map<string, Map<Origin, number>>> {
    if (eans.length === 0 || origins.length === 0) return new Map();

    const result = await this.repository
      .createQueryBuilder('product')
      .select('product.ean', 'ean')
      .addSelect('product.origin', 'origin')
      .addSelect('product.price', 'price')
      .where('product.ean IN (:...eans)', { eans })
      .andWhere('product.origin IN (:...origins)', { origins })
      .andWhere('product.price > 0')
      .getRawMany();

    const map = new Map<string, Map<Origin, number>>();
    for (const row of result) {
      const ean = String(row.ean);
      if (!map.has(ean)) {
        map.set(ean, new Map());
      }
      map.get(ean)!.set(row.origin as Origin, Number(row.price));
    }
    return map;
  }

  public async findByEansAndOrigins(eans: number[], origins: Origin[]): Promise<ProductTypeormEntity[]> {
    if (eans.length === 0) return [];

    return this.repository.find({
      where: eans.map((ean) => origins.map((origin) => ({ ean, origin }))).flat(),
      relations: ['stock']
    });
  }
}
