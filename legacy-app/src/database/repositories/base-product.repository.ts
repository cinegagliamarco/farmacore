import { Injectable } from '@nestjs/common';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { BaseProductOrigin } from '../../common/base-product-origin.enum';
import { StockStatus } from '../../common/stock-status.enum';
import { StockMetricsFilters } from '../../dto/get-base-product-stock-metrics-query-param.dto';
import { ProductStockFilters } from '../../dto/get-base-product-stock-query-param.dto';
import { BaseProductFilters } from '../../dto/get-base-products-query-param.dto';
import { ProductFilters } from '../../dto/get-crossed-products-query-param.dto';
import { GenericMissingActiveIngredientsFilters } from '../../dto/get-generic-missing-active-ingredients-query-param.dto';
import { BaseProductStockMetrics } from '../../use-cases/get-base-product-stock-metrics.use-case';
import { BaseProductTypeormEntity } from '../entities/base-product.entity';
import { ClassificationTypeormEntity } from '../entities/classification.entity';
import { ProductStockTypeormEntity } from '../entities/product-stock.entity';
import { ProductTypeormEntity } from '../entities/product.entity';

export interface CompetitorPrices {
  drogalPrice: number;
  drogalObservation: string | null;
  drogalIsPbm: boolean;
  drogalVan: string | null;
  drogasilPrice: number;
  drogasilObservation: string | null;
  drogasilIsPbm: boolean;
  michelassiPrice: number;
}

export interface BaseProductWithCompetitorPrices {
  baseProduct: BaseProductTypeormEntity;
  competitorPrices: CompetitorPrices;
}

export interface ProductWithStock {
  product: ProductTypeormEntity;
  productStock: ProductStockTypeormEntity | null;
}

export interface BaseProductWithFullStock {
  baseProduct: BaseProductTypeormEntity;
  products: ProductWithStock[];
  stockStatus: StockStatus;
}

@Injectable()
export class BaseProductRepository {
  constructor(
    private readonly repository: Repository<BaseProductTypeormEntity>,
    private readonly classificationRepository: Repository<ClassificationTypeormEntity>
  ) {}

  public findAll(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find();
  }

  /**
   * Counts base products that have no images and are not marked to skip generation.
   */
  public countWithoutImages(): Promise<number> {
    return this.repository
      .createQueryBuilder('base_product')
      .where('base_product.skip_image_generation = :skipImageGeneration', { skipImageGeneration: false })
      .andWhere('NOT EXISTS (SELECT 1 FROM base_product_image bpi WHERE bpi.base_product_id = base_product.id)')
      .getCount();
  }

  /**
   * Loads a small batch of base products (id + ean only) for image generation, ordered by id.
   * Use cursor pagination with lastId to avoid loading tens of thousands of entities at once.
   */
  public findBatchWithoutImagesAfter(lastId: number, take: number): Promise<BaseProductTypeormEntity[]> {
    return this.repository
      .createQueryBuilder('base_product')
      .select(['base_product.id', 'base_product.ean'])
      .where('base_product.skip_image_generation = :skipImageGeneration', { skipImageGeneration: false })
      .andWhere('NOT EXISTS (SELECT 1 FROM base_product_image bpi WHERE bpi.base_product_id = base_product.id)')
      .andWhere('base_product.id > :lastId', { lastId })
      .orderBy('base_product.id', 'ASC')
      .take(take)
      .getMany();
  }

  public async setSkipImageGeneration(baseProductId: number, skip: boolean): Promise<void> {
    await this.repository.update({ id: baseProductId }, { skipImageGeneration: skip });
  }

  public async getProductsCrossedPaginated(page: number, pageSize: number): Promise<[BaseProductWithCompetitorPrices[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true })
      .leftJoin('product', 'drogal_product', 'base_product.ean = drogal_product.ean AND drogal_product.origin = :drogalOrigin', {
        drogalOrigin: 'DROGAL'
      })
      .leftJoin('product', 'drogasil_product', 'base_product.ean = drogasil_product.ean AND drogasil_product.origin = :drogasilOrigin', {
        drogasilOrigin: 'DROGASIL'
      })
      .leftJoin('product', 'michelassi_product', 'base_product.ean = michelassi_product.ean AND michelassi_product.origin = :michelassiOrigin', {
        michelassiOrigin: 'MICHELASSI'
      })
      .addSelect('COALESCE(drogal_product.price, 0)', 'drogalPrice')
      .addSelect('drogal_product.observation', 'drogalObservation')
      .addSelect('COALESCE(drogal_product.is_pbm, false)', 'drogalIsPbm')
      .addSelect('drogal_product.van', 'drogalVan')
      .addSelect('COALESCE(drogasil_product.price, 0)', 'drogasilPrice')
      .addSelect('drogasil_product.observation', 'drogasilObservation')
      .addSelect('COALESCE(drogasil_product.is_pbm, false)', 'drogasilIsPbm')
      .addSelect('COALESCE(michelassi_product.price, 0)', 'michelassiPrice')
      .skip(((page <= 0 ? 1 : page) - 1) * pageSize)
      .take(pageSize);

    const { entities, raw } = await queryBuilder.getRawAndEntities();
    const count = await queryBuilder.getCount();

    return [
      entities.map((entity, index) => ({
        baseProduct: entity,
        competitorPrices: {
          drogalPrice: Number(raw[index]?.drogalPrice) || 0,
          drogalObservation: raw[index]?.drogalObservation || null,
          drogalIsPbm: raw[index]?.drogalIsPbm === true || raw[index]?.drogalIsPbm === 'true',
          drogalVan: raw[index]?.drogalVan || null,
          drogasilPrice: Number(raw[index]?.drogasilPrice) || 0,
          drogasilObservation: raw[index]?.drogasilObservation || null,
          drogasilIsPbm: raw[index]?.drogasilIsPbm === true || raw[index]?.drogasilIsPbm === 'true',
          michelassiPrice: Number(raw[index]?.michelassiPrice) || 0
        }
      })),
      count
    ];
  }

  public async getProductsCrossedPaginatedWithSort(
    page: number,
    pageSize: number,
    sortBy?: string,
    sortDirection?: 'ASC' | 'DESC',
    filters?: ProductFilters
  ): Promise<[BaseProductWithCompetitorPrices[], number]> {
    const columnMap: Record<string, string> = {
      id: 'base_product.id',
      ean: 'base_product.ean',
      name: 'base_product.name',
      supplier: 'base_product.supplier',
      classification: 'classification.name',
      book: 'offerBooks.name',
      cost: 'base_product.cost',
      priceForSell: 'base_product.price',
      priceForOffer: 'offerBooks.priceForOffer',
      margin: 'base_product.margin',
      averageVariation: 'base_product.averageVariation',
      status: 'base_product.status',
      receiptDate: 'base_product.receiptDate'
    };

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true })
      .leftJoin('product', 'drogal_product', 'base_product.ean = drogal_product.ean AND drogal_product.origin = :drogalOrigin', {
        drogalOrigin: 'DROGAL'
      })
      .leftJoin('product', 'drogasil_product', 'base_product.ean = drogasil_product.ean AND drogasil_product.origin = :drogasilOrigin', {
        drogasilOrigin: 'DROGASIL'
      })
      .leftJoin('product', 'michelassi_product', 'base_product.ean = michelassi_product.ean AND michelassi_product.origin = :michelassiOrigin', {
        michelassiOrigin: 'MICHELASSI'
      })
      .where('base_product.origin = :origin', { origin: BaseProductOrigin.ERP })
      .addSelect('COALESCE(drogal_product.price, 0)', 'drogalPrice')
      .addSelect('drogal_product.observation', 'drogalObservation')
      .addSelect('COALESCE(drogal_product.is_pbm, false)', 'drogalIsPbm')
      .addSelect('drogal_product.van', 'drogalVan')
      .addSelect('COALESCE(drogasil_product.price, 0)', 'drogasilPrice')
      .addSelect('drogasil_product.observation', 'drogasilObservation')
      .addSelect('COALESCE(drogasil_product.is_pbm, false)', 'drogasilIsPbm')
      .addSelect('COALESCE(michelassi_product.price, 0)', 'michelassiPrice');

    if (filters?.books && filters.books.length > 0) {
      queryBuilder.andWhere('offerBooks.name IN (:...books)', { books: filters.books });
    }

    if (filters?.status && filters.status.length > 0) {
      queryBuilder.andWhere('base_product.status IN (:...status)', { status: filters.status });
    }

    if (filters?.eans && filters.eans.length > 0) {
      queryBuilder.andWhere('base_product.ean IN (:...eans)', { eans: filters.eans });
    }

    if (filters?.classification) {
      queryBuilder.andWhere('classification.name ILIKE :classification', { classification: `%${filters.classification}%` });
    }

    if (filters?.name) {
      queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters?.supplier) {
      queryBuilder.andWhere('base_product.supplier ILIKE :supplier', { supplier: `%${filters.supplier}%` });
    }

    if (filters?.startReceiptDate && filters?.endReceiptDate) {
      queryBuilder.andWhere('base_product.receiptDate BETWEEN :startReceiptDate AND :endReceiptDate', {
        startReceiptDate: filters.startReceiptDate,
        endReceiptDate: filters.endReceiptDate
      });
    } else if (filters?.startReceiptDate) {
      queryBuilder.andWhere('base_product.receiptDate >= :startReceiptDate', { startReceiptDate: filters.startReceiptDate });
    } else if (filters?.endReceiptDate) {
      queryBuilder.andWhere('base_product.receiptDate <= :endReceiptDate', { endReceiptDate: filters.endReceiptDate });
    }

    if (sortBy && columnMap[sortBy]) {
      queryBuilder.orderBy(columnMap[sortBy], sortDirection || 'ASC');
    }

    queryBuilder
      .andWhere('base_product.active = :active', { active: true })
      .andWhere('(offerBooks.expirationDate IS NULL OR offerBooks.expirationDate >= NOW())')
      .skip(((page <= 0 ? 1 : page) - 1) * pageSize)
      .take(pageSize);

    const { entities, raw } = await queryBuilder.getRawAndEntities();
    const count = await queryBuilder.getCount();

    return [
      entities.map((entity, index) => ({
        baseProduct: entity,
        competitorPrices: {
          drogalPrice: Number(raw[index]?.drogalPrice) || 0,
          drogalObservation: raw[index]?.drogalObservation || null,
          drogalIsPbm: raw[index]?.drogalIsPbm === true || raw[index]?.drogalIsPbm === 'true',
          drogalVan: raw[index]?.drogalVan || null,
          drogasilPrice: Number(raw[index]?.drogasilPrice) || 0,
          drogasilObservation: raw[index]?.drogasilObservation || null,
          drogasilIsPbm: raw[index]?.drogasilIsPbm === true || raw[index]?.drogasilIsPbm === 'true',
          michelassiPrice: Number(raw[index]?.michelassiPrice) || 0
        }
      })),
      count
    ];
  }

  public async findWithoutImagesPaginated(page: number, pageSize: number): Promise<BaseProductTypeormEntity[]> {
    return this.repository
      .createQueryBuilder('base_product')
      .where('base_product.skip_image_generation = :skipImageGeneration', { skipImageGeneration: false })
      .andWhere('NOT EXISTS (SELECT 1 FROM base_product_image bpi WHERE bpi.base_product_id = base_product.id)')
      .skip(((page <= 0 ? 1 : page) - 1) * pageSize)
      .take(pageSize)
      .getMany();
  }

  public async save(entity: BaseProductTypeormEntity): Promise<BaseProductTypeormEntity> {
    const existingEntity = await this.findOne(entity.ean);
    if (existingEntity) entity.id = existingEntity.id; // Update the entity if it already exists

    return this.repository.save(entity);
  }

  /**
   * Bulk upsert base products by unique `ean`, returning a Map of ean -> id.
   * Deduplicates by ean and releases any stale `external_id` that conflicts with the
   * incoming batch before upserting, so the unique constraint on `external_id` never trips.
   */
  public async upsertManyByEan(entities: BaseProductTypeormEntity[]): Promise<Map<number, number>> {
    if (entities.length === 0) return new Map();

    const deduped = this.dedupeByEan(entities);
    const chunkSize = 500;
    const result = new Map<number, number>();

    for (let i = 0; i < deduped.length; i += chunkSize) {
      const chunk = deduped.slice(i, i + chunkSize);
      await this.releaseConflictingExternalIds(chunk);
      await this.repository.upsert(chunk, { conflictPaths: ['ean'], skipUpdateIfNoValuesChanged: true });

      const eans = chunk.map((e) => e.ean);
      const rows = await this.repository.find({ where: { ean: In(eans) }, select: ['id', 'ean'] });
      for (const row of rows) result.set(Number(row.ean), row.id);
    }

    return result;
  }

  /**
   * Last-write-wins dedupe by `ean`. The integration source (`embalagem`) can hold multiple
   * packagings sharing one barcode, so a single batch may carry duplicates that would break
   * `ON CONFLICT (ean)` ("cannot affect row a second time").
   */
  private dedupeByEan(entities: BaseProductTypeormEntity[]): BaseProductTypeormEntity[] {
    const byEan = new Map<number, BaseProductTypeormEntity>();
    for (const entity of entities) byEan.set(Number(entity.ean), entity);
    return [...byEan.values()];
  }

  /**
   * Null out `external_id` on any existing row whose `external_id` matches one we are about
   * to insert under a different `ean`. Without this the upsert would violate
   * `UQ_BASE_PRODUCT_EXTERNAL_ID` whenever an embalagem id is reassigned to a new barcode.
   */
  private async releaseConflictingExternalIds(chunk: BaseProductTypeormEntity[]): Promise<void> {
    const incoming = chunk.filter((e) => e.externalId != null).map((e) => ({ ean: Number(e.ean), externalId: Number(e.externalId) }));
    if (incoming.length === 0) return;

    const externalIds = incoming.map((p) => p.externalId);
    const eans = incoming.map((p) => p.ean);

    await this.repository
      .createQueryBuilder()
      .update()
      .set({ externalId: () => 'NULL' })
      .where('external_id IN (:...externalIds)', { externalIds })
      .andWhere('ean NOT IN (:...eans)', { eans })
      .execute();
  }

  public findOne(ean: number): Promise<BaseProductTypeormEntity | undefined> {
    return this.repository.findOne({ where: { ean } });
  }

  public findById(id: number): Promise<BaseProductTypeormEntity> {
    return this.repository.findOne({ where: { id }, relations: ['offerBooks', 'classificationEntity'] });
  }

  public findActiveByIds(ids: number[]): Promise<BaseProductTypeormEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repository.find({ where: { id: In(ids), active: true }, order: { name: 'ASC' }, relations: ['offerBooks', 'classificationEntity'] });
  }

  public async findActiveByGroupedClassifications(groupedClassifications: string[]): Promise<BaseProductTypeormEntity[]> {
    if (groupedClassifications.length === 0) return [];

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .where('base_product.active = :active', { active: true })
      .andWhere(
        new Brackets((qb) => {
          groupedClassifications.forEach((classification, index) => {
            qb.orWhere(`classification.name LIKE :classification${index}`, {
              [`classification${index}`]: `${classification}%`
            });
          });
        })
      );

    return queryBuilder.orderBy('base_product.name', 'ASC').getMany();
  }

  public async findActiveByGroupedClassificationsPaginated(
    groupedClassifications: string[],
    offset: number,
    limit: number
  ): Promise<[BaseProductTypeormEntity[], number]> {
    if (groupedClassifications.length === 0) return [[], 0];

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .where('base_product.active = :active', { active: true })
      .andWhere('1=0');

    groupedClassifications.forEach((classification, index) => {
      queryBuilder.orWhere(`classification.name LIKE :classification${index}`, {
        [`classification${index}`]: `${classification}%`
      });
    });

    queryBuilder.orderBy('base_product.name', 'ASC');

    const total = await queryBuilder.getCount();

    if (total === 0) return [[], 0];

    const rows = await queryBuilder.skip(offset).take(limit).getMany();

    return [rows, total];
  }

  public async findActiveByOfferBookRulesPaginated(rulesId: number, offset: number, limit: number): Promise<[BaseProductTypeormEntity[], number]> {
    const countResult = await this.repository
      .createQueryBuilder('base_product')
      .innerJoin('offer_book_rules_products', 'obrp', 'obrp.base_product_id = base_product.id')
      .where('obrp.offer_book_rules_id = :rulesId', { rulesId })
      .andWhere('base_product.active = :active', { active: true })
      .getCount();

    if (countResult === 0) return [[], 0];

    const rows = await this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .innerJoin('offer_book_rules_products', 'obrp', 'obrp.base_product_id = base_product.id')
      .where('obrp.offer_book_rules_id = :rulesId', { rulesId })
      .andWhere('base_product.active = :active', { active: true })
      .orderBy('base_product.name', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    return [rows, countResult];
  }

  public findAllEANs(): Promise<{ ean: number }[]> {
    return this.repository.find({ select: ['ean'] });
  }

  public findAllWithoutDescription(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find({ where: { description: IsNull() } });
  }

  public async updateDescription(ean: number, description: string): Promise<void> {
    await this.repository.update({ ean }, { description });
  }

  public async resetBaseProducts(): Promise<void> {
    await this.repository.query(`DELETE FROM base_product`);
  }

  public async resetBaseProductImages(): Promise<void> {
    await this.repository.query(`DELETE FROM base_product_image`);
  }

  public async resetAll(): Promise<void> {
    await this.resetBaseProducts();
    await this.resetBaseProductImages();
    await this.repository.query(`DELETE FROM product`);
    await this.repository.query(`DELETE FROM import_process`);
  }

  public async deleteByEan(ean: number): Promise<void> {
    await this.repository.delete({ ean });
  }

  public async deleteById(id: number): Promise<void> {
    await this.repository.delete({ id });
  }

  public async getProductsWithObservationsPaginated(
    page: number,
    pageSize: number,
    sortBy?: string,
    sortDirection?: 'ASC' | 'DESC',
    filters?: ProductFilters
  ): Promise<[BaseProductWithCompetitorPrices[], number]> {
    const columnMap: Record<string, string> = {
      id: 'base_product.id',
      ean: 'base_product.ean',
      name: 'base_product.name',
      supplier: 'base_product.supplier',
      classification: 'classification.name',
      book: 'offerBooks.name',
      cost: 'base_product.cost',
      priceForSell: 'base_product.price',
      priceForOffer: 'offerBooks.priceForOffer',
      margin: 'base_product.margin',
      averageVariation: 'base_product.averageVariation',
      status: 'base_product.status'
    };

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .leftJoin('product', 'products', 'base_product.ean = products.ean AND products.origin IN (:...origins) AND products.observation IS NOT NULL', {
        origins: ['DROGAL', 'DROGASIL']
      })
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true })
      .where('(products.ean IS NOT NULL OR base_product.deals IS NOT NULL)')
      .andWhere('base_product.origin = :origin', { origin: BaseProductOrigin.ERP })
      .leftJoin('product', 'drogal_product', 'base_product.ean = drogal_product.ean AND drogal_product.origin = :drogalOrigin', {
        drogalOrigin: 'DROGAL'
      })
      .leftJoin('product', 'drogasil_product', 'base_product.ean = drogasil_product.ean AND drogasil_product.origin = :drogasilOrigin', {
        drogasilOrigin: 'DROGASIL'
      })
      .leftJoin('product', 'michelassi_product', 'base_product.ean = michelassi_product.ean AND michelassi_product.origin = :michelassiOrigin', {
        michelassiOrigin: 'MICHELASSI'
      })
      .addSelect('COALESCE(drogal_product.price, 0)', 'drogalPrice')
      .addSelect('drogal_product.observation', 'drogalObservation')
      .addSelect('COALESCE(drogal_product.is_pbm, false)', 'drogalIsPbm')
      .addSelect('drogal_product.van', 'drogalVan')
      .addSelect('COALESCE(drogasil_product.price, 0)', 'drogasilPrice')
      .addSelect('drogasil_product.observation', 'drogasilObservation')
      .addSelect('COALESCE(drogasil_product.is_pbm, false)', 'drogasilIsPbm')
      .addSelect('COALESCE(michelassi_product.price, 0)', 'michelassiPrice');

    if (filters?.books && filters.books.length > 0) {
      queryBuilder.andWhere('offerBooks.name IN (:...books)', { books: filters.books });
    }

    if (filters?.status && filters.status.length > 0) {
      queryBuilder.andWhere('base_product.status IN (:...status)', { status: filters.status });
    }

    if (filters?.eans && filters.eans.length > 0) {
      queryBuilder.andWhere('base_product.ean IN (:...eans)', { eans: filters.eans });
    }

    if (filters?.classification) {
      queryBuilder.andWhere('classification.name ILIKE :classification', { classification: `%${filters.classification}%` });
    }

    if (filters?.name) {
      queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters?.supplier) {
      queryBuilder.andWhere('base_product.supplier ILIKE :supplier', { supplier: `%${filters.supplier}%` });
    }

    if (sortBy && columnMap[sortBy]) {
      queryBuilder.orderBy(columnMap[sortBy], sortDirection || 'ASC');
    }

    queryBuilder
      .andWhere('(offerBooks.expirationDate IS NULL OR offerBooks.expirationDate >= NOW())')
      .skip(((page <= 0 ? 1 : page) - 1) * pageSize)
      .take(pageSize);

    const { entities, raw } = await queryBuilder.getRawAndEntities();
    const count = await queryBuilder.getCount();

    return [
      entities.map((entity, index) => ({
        baseProduct: entity,
        competitorPrices: {
          drogalPrice: Number(raw[index]?.drogalPrice) || 0,
          drogalObservation: raw[index]?.drogalObservation || null,
          drogalIsPbm: raw[index]?.drogalIsPbm === true || raw[index]?.drogalIsPbm === 'true',
          drogalVan: raw[index]?.drogalVan || null,
          drogasilPrice: Number(raw[index]?.drogasilPrice) || 0,
          drogasilObservation: raw[index]?.drogasilObservation || null,
          drogasilIsPbm: raw[index]?.drogasilIsPbm === true || raw[index]?.drogasilIsPbm === 'true',
          michelassiPrice: Number(raw[index]?.michelassiPrice) || 0
        }
      })),
      count
    ];
  }

  public getByEmptySupplier(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find({ where: [{ supplier: IsNull() }, { supplier: '' }] });
  }

  public getByEmptyName(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find({ where: [{ name: IsNull() }, { name: '' }] });
  }

  public getByEmptyWeight(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find({ where: [{ weight: IsNull() }, { weight: 0 }] });
  }

  public getByEmptyMeasures(): Promise<BaseProductTypeormEntity[]> {
    return this.repository.find({ where: { cubicWeight: IsNull() } });
  }

  // Subqueries SQL otimizadas para cálculo de stock status
  private getStockStatusSqlExpression(): string {
    // Conta lojas de concorrentes com estoque (usando agregação - 1 query ao invés de 6)
    const competitorsSubquery = `(
      SELECT COALESCE(SUM(
        CASE WHEN COALESCE(ps.subsidiary_one_stock, 0) > 0 THEN 1 ELSE 0 END +
        CASE WHEN COALESCE(ps.subsidiary_two_stock, 0) > 0 THEN 1 ELSE 0 END
      ), 0)
      FROM product p
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      WHERE p.ean = base_product.ean
      AND p.origin IN ('DROGAL', 'DROGASIL', 'MICHELASSI')
    )`;

    // Conta lojas próprias com estoque
    const ownStoresSubquery = `(
      SELECT COUNT(*) FROM base_product_stock bps
      WHERE bps.base_product_id = base_product.id AND bps.quantity > 0
    )`;

    // Expressão CASE para calcular o status
    return `
      CASE
        WHEN (${competitorsSubquery} >= 2 AND ${ownStoresSubquery} = 0)
             OR (${competitorsSubquery} = 3 AND ${ownStoresSubquery} <= 2)
        THEN '${StockStatus.ANALYZE_INCLUSION}'
        WHEN (${competitorsSubquery} = 1 AND ${ownStoresSubquery} = 0)
             OR (${competitorsSubquery} = 2 AND ${ownStoresSubquery} = 1)
        THEN '${StockStatus.POTENTIAL}'
        ELSE '${StockStatus.OK}'
      END
    `;
  }

  public async findAllWithStockPaginated(
    page: number,
    pageSize: number,
    sortBy?: string,
    sortDirection?: 'ASC' | 'DESC',
    filters?: ProductStockFilters
  ): Promise<[BaseProductWithFullStock[], number]> {
    const columnMap: Record<string, string> = {
      id: 'base_product.id',
      ean: 'base_product.ean',
      name: 'base_product.name',
      supplier: 'base_product.supplier',
      classification: 'classification.name',
      book: 'offerBooks.name',
      cost: 'base_product.cost',
      price: 'base_product.price',
      margin: 'base_product.margin',
      averageVariation: 'base_product.averageVariation',
      status: 'base_product.status',
      curve: 'base_product.curve',
      mat: 'base_product.mat'
    };

    const stockStatusExpression = this.getStockStatusSqlExpression();
    const hasStockStatusFilter = filters?.stockStatus && filters.stockStatus.length > 0;

    // Helper para aplicar filtros comuns
    const applyCommonFilters = (qb: ReturnType<typeof this.repository.createQueryBuilder>) => {
      qb.andWhere(
        `(
          EXISTS (SELECT 1 FROM base_product_stock bps WHERE bps.base_product_id = base_product.id AND bps.quantity > 0)
          OR EXISTS (
            SELECT 1 FROM product p
            LEFT JOIN product_stock ps ON ps.product_id = p.id
            WHERE p.ean = base_product.ean AND (ps.subsidiary_one_stock > 0 OR ps.subsidiary_two_stock > 0)
          )
        )`
      );

      if (filters?.books && filters.books.length > 0) {
        qb.andWhere('offerBooks.name IN (:...books)', { books: filters.books });
      }
      if (filters?.status && filters.status.length > 0) {
        qb.andWhere('base_product.status IN (:...status)', { status: filters.status });
      }
      if (filters?.eans && filters.eans.length > 0) {
        qb.andWhere('base_product.ean IN (:...eans)', { eans: filters.eans });
      }
      if (filters?.classification) {
        qb.andWhere('classification.name ILIKE :classification', { classification: `%${filters.classification}%` });
      }
      if (filters?.name) {
        qb.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
      }
      if (filters?.supplier) {
        qb.andWhere('base_product.supplier ILIKE :supplier', { supplier: `%${filters.supplier}%` });
      }
      if (filters?.curve) {
        qb.andWhere('base_product.curve = :curve', { curve: filters.curve });
      }
      if (filters?.origin) {
        qb.andWhere('base_product.origin = :origin', { origin: filters.origin });
      }
      if (hasStockStatusFilter) {
        qb.andWhere(`(${stockStatusExpression}) IN (:...stockStatusFilter)`, {
          stockStatusFilter: filters!.stockStatus
        });
      }
    };

    // Query principal para dados paginados
    const dataQueryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .leftJoinAndSelect('base_product.stocks', 'stocks')
      .leftJoinAndSelect('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true })
      .addSelect(stockStatusExpression, 'stock_status');

    applyCommonFilters(dataQueryBuilder);

    if (sortBy && columnMap[sortBy]) {
      dataQueryBuilder.orderBy(columnMap[sortBy], sortDirection || 'ASC');
    }

    dataQueryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);

    // Query para count (sem joins pesados e sem paginação)
    const countQueryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoin('base_product.classificationEntity', 'classification')
      .leftJoin('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true });

    applyCommonFilters(countQueryBuilder);

    // Executa as duas queries em PARALELO
    const [{ entities: baseProducts, raw }, totalCount] = await Promise.all([dataQueryBuilder.getRawAndEntities(), countQueryBuilder.getCount()]);

    const eans = baseProducts.map((bp) => bp.ean);

    if (eans.length === 0) {
      return [[], 0];
    }

    // Fetch all products with matching EANs
    const productsWithStock = await this.repository.manager
      .createQueryBuilder(ProductTypeormEntity, 'product')
      .leftJoinAndSelect('product.stock', 'product_stock')
      .where('product.ean IN (:...eans)', { eans })
      .getMany();

    // Group products by EAN
    const productsByEan = new Map<string, ProductWithStock[]>();
    for (const product of productsWithStock) {
      const ean = String(product.ean);
      if (!productsByEan.has(ean)) {
        productsByEan.set(ean, []);
      }
      productsByEan.get(ean)!.push({
        product,
        productStock: product.stock || null
      });
    }

    // Build the result with stockStatus from SQL
    const result: BaseProductWithFullStock[] = baseProducts.map((baseProduct, index) => {
      const products = productsByEan.get(String(baseProduct.ean)) || [];
      const stockStatus = (raw[index]?.stock_status as StockStatus) || StockStatus.OK;

      return {
        baseProduct,
        products,
        stockStatus
      };
    });

    return [result, totalCount];
  }

  public async findAllStockMetrics(filters?: StockMetricsFilters): Promise<BaseProductStockMetrics> {
    const stockStatusExpression = this.getStockStatusSqlExpression();

    // Build the base query with filters (no pagination)
    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoin('base_product.classificationEntity', 'classification')
      .leftJoin('base_product.offerBooks', 'offerBooks', 'offerBooks.active = :offerBookActive', { offerBookActive: true })
      .andWhere(
        `(
          EXISTS (SELECT 1 FROM base_product_stock bps WHERE bps.base_product_id = base_product.id AND bps.quantity > 0)
          OR EXISTS (
            SELECT 1 FROM product p
            LEFT JOIN product_stock ps ON ps.product_id = p.id
            WHERE p.ean = base_product.ean AND (ps.subsidiary_one_stock > 0 OR ps.subsidiary_two_stock > 0)
          )
        )`
      );

    if (filters?.books && filters.books.length > 0) {
      queryBuilder.andWhere('offerBooks.name IN (:...books)', { books: filters.books });
    }

    if (filters?.status && filters.status.length > 0) {
      queryBuilder.andWhere('base_product.status IN (:...status)', { status: filters.status });
    }

    if (filters?.eans && filters.eans.length > 0) {
      queryBuilder.andWhere('base_product.ean IN (:...eans)', { eans: filters.eans });
    }

    if (filters?.classification) {
      queryBuilder.andWhere('classification.name ILIKE :classification', { classification: `%${filters.classification}%` });
    }

    if (filters?.name) {
      queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters?.supplier) {
      queryBuilder.andWhere('base_product.supplier = :supplier', { supplier: filters.supplier });
    }

    // Filtro por stockStatus
    if (filters?.stockStatus && filters.stockStatus.length > 0) {
      queryBuilder.andWhere(`(${stockStatusExpression}) IN (:...stockStatusFilter)`, {
        stockStatusFilter: filters.stockStatus
      });
    }

    // Get all base_product IDs and EANs that match the filters (use distinct to avoid duplicates from offerBooks join)
    const baseProducts = await queryBuilder.select(['base_product.id', 'base_product.ean']).distinct(true).getMany();

    const total = baseProducts.length;

    if (total === 0) {
      return {
        total: 0,
        stock: {},
        drogalStock: {},
        drogasilStock: {},
        michelassiStock: {}
      };
    }

    const baseProductIds = baseProducts.map((bp) => bp.id);
    const eans = baseProducts.map((bp) => bp.ean);

    // Count base_product_stock by subsidiary_name (quantity > 0)
    const baseProductStockCounts = await this.repository.manager
      .createQueryBuilder()
      .select('bps.subsidiary_name', 'subsidiaryName')
      .addSelect('COUNT(DISTINCT bps.base_product_id)', 'count')
      .from('base_product_stock', 'bps')
      .where('bps.base_product_id IN (:...baseProductIds)', { baseProductIds })
      .andWhere('bps.quantity > 0')
      .groupBy('bps.subsidiary_name')
      .getRawMany();

    // Count product_stock by origin for subsidiary_one_stock > 0
    const productStockSubsidiaryOneCounts = await this.repository.manager
      .createQueryBuilder()
      .select('p.origin', 'origin')
      .addSelect('COUNT(DISTINCT p.ean)', 'count')
      .from('product', 'p')
      .leftJoin('product_stock', 'ps', 'ps.product_id = p.id')
      .where('p.ean IN (:...eans)', { eans })
      .andWhere('ps.subsidiary_one_stock > 0')
      .groupBy('p.origin')
      .getRawMany();

    // Count product_stock by origin for subsidiary_two_stock > 0
    const productStockSubsidiaryTwoCounts = await this.repository.manager
      .createQueryBuilder()
      .select('p.origin', 'origin')
      .addSelect('COUNT(DISTINCT p.ean)', 'count')
      .from('product', 'p')
      .leftJoin('product_stock', 'ps', 'ps.product_id = p.id')
      .where('p.ean IN (:...eans)', { eans })
      .andWhere('ps.subsidiary_two_stock > 0')
      .groupBy('p.origin')
      .getRawMany();

    // Transform results to percentages: (count / total) * 100 with 2 decimal places
    const stock: Record<string, number> = {};
    for (const row of baseProductStockCounts) {
      stock[row.subsidiaryName] = parseFloat(((Number(row.count) / total) * 100).toFixed(2));
    }

    // Build maps for subsidiary one and two counts by origin
    const subsidiaryOneByOrigin: Record<string, number> = {};
    for (const row of productStockSubsidiaryOneCounts) {
      subsidiaryOneByOrigin[row.origin] = parseFloat(((Number(row.count) / total) * 100).toFixed(2));
    }

    const subsidiaryTwoByOrigin: Record<string, number> = {};
    for (const row of productStockSubsidiaryTwoCounts) {
      subsidiaryTwoByOrigin[row.origin] = parseFloat(((Number(row.count) / total) * 100).toFixed(2));
    }

    // Build response grouped by origin with their subsidiaries
    const drogalStock: Record<string, number> = {
      drogal1: subsidiaryOneByOrigin['DROGAL'] ?? 0,
      drogal2: subsidiaryTwoByOrigin['DROGAL'] ?? 0
    };

    const drogasilStock: Record<string, number> = {
      drogasil: subsidiaryOneByOrigin['DROGASIL'] ?? 0
    };

    const michelassiStock: Record<string, number> = {
      michelassi: subsidiaryOneByOrigin['MICHELASSI'] ?? 0
    };

    return {
      total,
      stock,
      drogalStock,
      drogasilStock,
      michelassiStock
    };
  }

  public async getBaseProductsPaginated(
    page: number,
    pageSize: number,
    sortBy?: string,
    sortDirection?: 'ASC' | 'DESC',
    filters?: BaseProductFilters
  ): Promise<[BaseProductTypeormEntity[], number]> {
    const columnMap: Record<string, string> = {
      ean: 'base_product.ean',
      name: 'base_product.name',
      supplier: 'base_product.supplier',
      mat: 'base_product.mat',
      curve: 'base_product.curve',
      updatedDate: 'base_product.updated_date',
      generic: 'base_product.generic',
      classification: 'classification.path'
    };

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .leftJoinAndSelect('base_product.images', 'images');

    if (filters) {
      const { curve, name, eans, origin, generic, classification, active } = filters;

      if (curve?.length) queryBuilder.andWhere('base_product.curve IN (:...curve)', { curve });
      if (eans?.length) queryBuilder.andWhere('base_product.ean IN (:...eans)', { eans });
      if (name) queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
      if (origin) queryBuilder.andWhere('base_product.origin = :origin', { origin });
      if (generic) queryBuilder.andWhere('base_product.generic =:generic', { generic });
      if (classification) queryBuilder.andWhere('classification.name =:classification', { classification });
      if (active) queryBuilder.andWhere('base_product.active = :active', { active });
    }

    if (sortBy && columnMap[sortBy]) {
      queryBuilder.orderBy(columnMap[sortBy], sortDirection || 'ASC');
    }

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);

    return queryBuilder.getManyAndCount();
  }

  public async getGenericMissingActiveIngredientsPaginated(
    page: number,
    pageSize: number,
    sortBy?: string,
    sortDirection?: 'ASC' | 'DESC',
    filters?: GenericMissingActiveIngredientsFilters
  ): Promise<[BaseProductTypeormEntity[], number]> {
    const columnMap: Record<string, string> = {
      ean: 'base_product.ean',
      name: 'base_product.name',
      supplier: 'base_product.supplier'
    };

    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .andWhere('base_product.origin = :origin', { origin: BaseProductOrigin.CSV })
      .andWhere('base_product.generic IS TRUE')
      .andWhere('base_product.activeIngredient IS NULL');

    if (filters?.eans && filters.eans.length > 0) {
      queryBuilder.andWhere('base_product.ean IN (:...eans)', { eans: filters.eans });
    }

    if (filters?.name) {
      queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters?.supplier) {
      queryBuilder.andWhere('base_product.supplier = :supplier', { supplier: filters.supplier });
    }

    if (sortBy && columnMap[sortBy]) {
      queryBuilder.orderBy(columnMap[sortBy], sortDirection || 'ASC');
    }

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);

    const [results, count] = await queryBuilder.getManyAndCount();

    return [results, count];
  }

  public async findByOfferBookRulePaginated(
    productIds: number[],
    groupedClassifications: string[] | null,
    page: number,
    pageSize: number,
    nameFilter?: string
  ): Promise<[BaseProductTypeormEntity[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('base_product')
      .leftJoinAndSelect('base_product.classificationEntity', 'classification')
      .where('base_product.active = :active', { active: true });

    if (groupedClassifications && groupedClassifications.length > 0) {
      queryBuilder.andWhere('1=0');
      groupedClassifications.forEach((classification, index) => {
        queryBuilder.orWhere(`classification.name LIKE :classification${index}`, {
          [`classification${index}`]: `${classification}%`
        });
      });
    } else {
      if (productIds.length === 0) {
        return [[], 0];
      }
      queryBuilder.andWhere('base_product.id IN (:...productIds)', { productIds });
    }

    if (nameFilter) {
      queryBuilder.andWhere('base_product.name ILIKE :name', { name: `%${nameFilter}%` });
    }

    queryBuilder.orderBy('base_product.name', 'ASC');

    const total = await queryBuilder.getCount();

    if (total === 0) {
      return [[], 0];
    }

    queryBuilder.skip((page - 1) * pageSize).take(pageSize);

    const baseProducts = await queryBuilder.getMany();

    return [baseProducts, total];
  }
}
