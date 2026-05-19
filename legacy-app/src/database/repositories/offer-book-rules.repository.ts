import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OfferBookRulesStatus } from '../../common/offer-book-rules-status.enum';
import { OfferBookRulesTypeormEntity } from '../entities/offer-book-rules.entity';
import { OfferBookRulesProductsTypeormEntity } from '../entities/offer-book-rules-products.entity';
import { OfferBookRulesFilters } from '../../dto/offer-book-rules-query-param.dto';

@Injectable()
export class OfferBookRulesRepository {
  constructor(
    private readonly repository: Repository<OfferBookRulesTypeormEntity>,
    private readonly dataSource: DataSource
  ) {}

  public async findById(id: number): Promise<OfferBookRulesTypeormEntity | null> {
    const rules = await this.repository
      .createQueryBuilder('rules')
      .leftJoinAndSelect('rules.pricingRules', 'pricingRules')
      .leftJoinAndSelect('rules.priceLocks', 'priceLocks')
      .leftJoinAndSelect('rules.offerBookInfo', 'offerBookInfo')
      .where('rules.id = :id', { id })
      .getOne();

    if (rules) {
      const count = await this.repository
        .createQueryBuilder('rules')
        .leftJoin('rules.products', 'products')
        .leftJoin('products.baseProduct', 'baseProduct')
        .where('rules.id = :id', { id })
        .andWhere('baseProduct.active = :active', { active: true })
        .select('COUNT(products.id)', 'count')
        .getRawOne();

      rules.productsCount = Number.parseInt(count?.count || '0', 10);
    }

    return rules;
  }

  public async findByIdWithDetails(id: number): Promise<OfferBookRulesTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['pricingRules', 'priceLocks', 'offerBookInfo']
    });
  }

  public async findByIdWithProducts(id: number): Promise<OfferBookRulesTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['products', 'pricingRules', 'priceLocks', 'offerBookInfo']
    });
  }

  public async findByOfferBookInfoId(offerBookInfoId: number): Promise<OfferBookRulesTypeormEntity | null> {
    const rules = await this.repository
      .createQueryBuilder('rules')
      .leftJoinAndSelect('rules.pricingRules', 'pricingRules')
      .leftJoinAndSelect('rules.priceLocks', 'priceLocks')
      .where('rules.offerBookInfoId = :offerBookInfoId', { offerBookInfoId })
      .getOne();

    if (rules) {
      const count = await this.repository
        .createQueryBuilder('rules')
        .leftJoin('rules.products', 'products')
        .leftJoin('products.baseProduct', 'baseProduct')
        .where('rules.id = :id', { id: rules.id })
        .andWhere('baseProduct.active = :active', { active: true })
        .select('COUNT(products.id)', 'count')
        .getRawOne();

      rules.productsCount = Number.parseInt(count?.count || '0', 10);
    }

    return rules;
  }

  public async findPaginated(page: number, pageSize: number, filters: OfferBookRulesFilters): Promise<[OfferBookRulesTypeormEntity[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('rules')
      .leftJoinAndSelect('rules.pricingRules', 'pricingRules')
      .leftJoinAndSelect('rules.priceLocks', 'priceLocks');

    if (filters.offerBookInfoId !== undefined) {
      queryBuilder.andWhere('rules.offerBookInfoId = :offerBookInfoId', { offerBookInfoId: filters.offerBookInfoId });
    }

    if (filters.productIds !== undefined && filters.productIds.length > 0) {
      // Subquery to find rules that contain ALL the specified productIds
      const subQuery = this.repository
        .createQueryBuilder('subRules')
        .select('subRules.id')
        .innerJoin('subRules.products', 'subProducts')
        .where('subProducts.baseProductId IN (:...productIds)', { productIds: filters.productIds })
        .groupBy('subRules.id')
        .having('COUNT(DISTINCT subProducts.baseProductId) = :productCount', { productCount: filters.productIds.length });

      queryBuilder.andWhere(`rules.id IN (${subQuery.getQuery()})`);
      queryBuilder.setParameters(subQuery.getParameters());
    }

    if (filters.name) {
      queryBuilder.andWhere('rules.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters.active !== undefined) {
      queryBuilder.andWhere('rules.active = :active', { active: filters.active });
    }

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);
    queryBuilder.orderBy('rules.id', 'DESC');

    const [rules, count] = await queryBuilder.getManyAndCount();

    // Add product counts for each rule
    if (rules.length > 0) {
      const ruleIds = rules.map((rule) => rule.id);
      const counts = await this.repository
        .createQueryBuilder('rules')
        .leftJoin('rules.products', 'products')
        .leftJoin('products.baseProduct', 'baseProduct')
        .where('rules.id IN (:...ruleIds)', { ruleIds })
        .andWhere('baseProduct.active = :active', { active: true })
        .select('rules.id', 'ruleId')
        .addSelect('COUNT(products.id)', 'count')
        .groupBy('rules.id')
        .getRawMany();

      const countMap = new Map(counts.map((c) => [c.ruleId, Number.parseInt(c.count, 10)]));
      rules.forEach((rule) => {
        rule.productsCount = countMap.get(rule.id) || 0;
      });
    }

    return [rules, count];
  }

  public async findProductIdsByRulesId(rulesId: number): Promise<number[]> {
    const results = await this.dataSource
      .createQueryBuilder()
      .select('products.base_product_id', 'baseProductId')
      .from('offer_book_rules_products', 'products')
      .where('products.offer_book_rules_id = :rulesId', { rulesId })
      .getRawMany();

    return results.map((r) => Number(r.baseProductId));
  }

  public async countProductsByRulesId(rulesId: number): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('offer_book_rules_products', 'products')
      .where('products.offer_book_rules_id = :rulesId', { rulesId })
      .getRawOne();

    return Number(result?.count ?? 0);
  }

  public async updateStatus(id: number, status: OfferBookRulesStatus): Promise<void> {
    await this.repository.update(id, { status });
  }

  public async resetStuckRunningStatus(): Promise<number> {
    const result = await this.repository.update({ status: OfferBookRulesStatus.RUNNING }, { status: OfferBookRulesStatus.ERRORED });
    return result.affected ?? 0;
  }

  public async save(entity: OfferBookRulesTypeormEntity): Promise<OfferBookRulesTypeormEntity> {
    return this.repository.save(entity);
  }

  public async create(entity: Partial<OfferBookRulesTypeormEntity>): Promise<OfferBookRulesTypeormEntity> {
    const newEntity = this.repository.create(entity);
    return this.repository.save(newEntity);
  }

  public async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  public async deleteProductsByRulesId(rulesId: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .from('offer_book_rules_products')
      .where('offer_book_rules_id = :rulesId', { rulesId })
      .execute();
  }

  public async deletePricingRulesByRulesId(rulesId: number): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .from('offer_book_pricing_rules')
      .where('offer_book_rules_id = :rulesId', { rulesId })
      .execute();
  }

  public async deletePriceLocksByRulesId(rulesId: number): Promise<void> {
    await this.repository.createQueryBuilder().delete().from('offer_book_price_locks').where('offer_book_rules_id = :rulesId', { rulesId }).execute();
  }

  public async findScheduledForDay(dayOfWeek: number): Promise<OfferBookRulesTypeormEntity[]> {
    const rules = await this.repository
      .createQueryBuilder('rules')
      .leftJoinAndSelect('rules.pricingRules', 'pricingRules')
      .leftJoinAndSelect('rules.priceLocks', 'priceLocks')
      .leftJoinAndSelect('rules.offerBookInfo', 'offerBookInfo')
      .where('rules.scheduleEnabled = :enabled', { enabled: true })
      .andWhere('rules.scheduledDays LIKE :day', { day: `%${dayOfWeek}%` })
      .getMany();

    // Add product counts for each rule
    if (rules.length > 0) {
      const ruleIds = rules.map((rule) => rule.id);
      const counts = await this.repository
        .createQueryBuilder('rules')
        .leftJoin('rules.products', 'products')
        .leftJoin('products.baseProduct', 'baseProduct')
        .where('rules.id IN (:...ruleIds)', { ruleIds })
        .andWhere('baseProduct.active = :active', { active: true })
        .select('rules.id', 'ruleId')
        .addSelect('COUNT(products.id)', 'count')
        .groupBy('rules.id')
        .getRawMany();

      const countMap = new Map(counts.map((c) => [c.ruleId, Number.parseInt(c.count, 10)]));
      rules.forEach((rule) => {
        rule.productsCount = countMap.get(rule.id) || 0;
      });
    }

    return rules;
  }

  /**
   * Saves offer book rules with products in batches to avoid database parameter limits.
   * This method uses a transaction to ensure data consistency.
   *
   * @param entity - The OfferBookRulesTypeormEntity with all related data
   * @param batchSize - Number of products to insert per batch (default: 1000)
   * @returns The saved entity with pricing rules and price locks (without products loaded)
   */
  public async saveWithBatchedProducts(entity: OfferBookRulesTypeormEntity, batchSize: number = 1000): Promise<OfferBookRulesTypeormEntity> {
    return this.dataSource.transaction(async (manager) => {
      // Extract products to insert separately
      const products = entity.products || [];

      // Remove products from entity to avoid cascade insert
      entity.products = [];

      // Save the main entity with pricing rules and price locks (cascaded)
      const saved = await manager.save(OfferBookRulesTypeormEntity, entity);

      // Insert products in batches
      if (products.length > 0) {
        const productsRepository = manager.getRepository(OfferBookRulesProductsTypeormEntity);

        for (let i = 0; i < products.length; i += batchSize) {
          const batch = products.slice(i, i + batchSize);

          // Set the offerBookRulesId for each product in the batch
          batch.forEach((product) => {
            product.offerBookRulesId = saved.id;
          });

          // Insert the batch
          await productsRepository.insert(batch);

          console.log(
            `Inserted products batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)} (${batch.length} products)`
          );
        }

        console.log(`Successfully inserted ${products.length} products in ${Math.ceil(products.length / batchSize)} batches`);
      }

      return saved;
    });
  }
}
