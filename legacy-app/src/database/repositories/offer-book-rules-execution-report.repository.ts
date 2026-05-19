import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { OfferBookRulesExecutionReportTypeormEntity } from '../entities/offer-book-rules-execution-report.entity';
import { OfferBookRulesExecutionReportItemTypeormEntity } from '../entities/offer-book-rules-execution-report-item.entity';
import { ExecutionType } from '../../common/execution-type.enum';
import { ExecutionOutcome } from '../../common/execution-outcome.enum';

export interface ExecutionReportFilters {
  offerBookRulesId?: number;
  offerBookInfoId?: number;
  executionType?: ExecutionType;
  outcome?: ExecutionOutcome;
  startDate?: Date;
  endDate?: Date;
}

@Injectable()
export class OfferBookRulesExecutionReportRepository {
  constructor(
    private readonly repository: Repository<OfferBookRulesExecutionReportTypeormEntity>,
    private readonly dataSource: DataSource
  ) {}

  public async findById(id: number): Promise<OfferBookRulesExecutionReportTypeormEntity | null> {
    return this.repository.findOne({
      where: { id },
      relations: ['items', 'offerBookRules']
    });
  }

  public async findByIdWithPaginatedItems(
    id: number,
    page: number,
    pageSize: number,
    nameFilter?: string
  ): Promise<{
    report: OfferBookRulesExecutionReportTypeormEntity | null;
    items: any[];
    totalItems: number;
  }> {
    // First get the report without items
    const report = await this.repository.findOne({
      where: { id },
      relations: ['offerBookRules']
    });

    if (!report) {
      return { report: null, items: [], totalItems: 0 };
    }

    // Build query for paginated items
    const itemsQuery = this.dataSource
      .getRepository(OfferBookRulesExecutionReportItemTypeormEntity)
      .createQueryBuilder('item')
      .where('item.executionReportId = :reportId', { reportId: id });

    // Apply name filter if provided
    if (nameFilter) {
      itemsQuery.andWhere('item.name ILIKE :name', { name: `%${nameFilter}%` });
    }

    // Get total count for filtered items
    const totalItems = await itemsQuery.getCount();

    // Apply pagination and get items
    const items = await itemsQuery
      .orderBy('item.id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return { report, items, totalItems };
  }

  public async findLatestByRulesId(offerBookRulesId: number, limit: number = 10): Promise<OfferBookRulesExecutionReportTypeormEntity[]> {
    return this.repository.find({
      where: { offerBookRulesId },
      order: { executedAt: 'DESC' },
      take: limit
    });
  }

  public async findPaginatedByRulesId(
    offerBookRulesId: number,
    page: number,
    pageSize: number
  ): Promise<[OfferBookRulesExecutionReportTypeormEntity[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('report')
      .where('report.offerBookRulesId = :offerBookRulesId', { offerBookRulesId })
      .orderBy('report.executedAt', 'DESC');

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);

    return queryBuilder.getManyAndCount();
  }

  public async findPaginated(
    page: number,
    pageSize: number,
    filters: ExecutionReportFilters
  ): Promise<[OfferBookRulesExecutionReportTypeormEntity[], number]> {
    const queryBuilder = this.repository.createQueryBuilder('report');

    if (filters.offerBookRulesId !== undefined) {
      queryBuilder.andWhere('report.offerBookRulesId = :offerBookRulesId', {
        offerBookRulesId: filters.offerBookRulesId
      });
    }

    if (filters.offerBookInfoId !== undefined) {
      queryBuilder.andWhere('report.offerBookInfoId = :offerBookInfoId', {
        offerBookInfoId: filters.offerBookInfoId
      });
    }

    if (filters.executionType !== undefined) {
      queryBuilder.andWhere('report.executionType = :executionType', {
        executionType: filters.executionType
      });
    }

    if (filters.outcome !== undefined) {
      queryBuilder.andWhere('report.outcome = :outcome', { outcome: filters.outcome });
    }

    if (filters.startDate) {
      queryBuilder.andWhere('report.executedAt >= :startDate', { startDate: filters.startDate });
    }

    if (filters.endDate) {
      queryBuilder.andWhere('report.executedAt <= :endDate', { endDate: filters.endDate });
    }

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);
    queryBuilder.orderBy('report.executedAt', 'DESC');

    return queryBuilder.getManyAndCount();
  }

  public async save(entity: OfferBookRulesExecutionReportTypeormEntity): Promise<OfferBookRulesExecutionReportTypeormEntity> {
    return this.repository.save(entity);
  }

  public async create(entity: Partial<OfferBookRulesExecutionReportTypeormEntity>): Promise<OfferBookRulesExecutionReportTypeormEntity> {
    const newEntity = this.repository.create(entity);
    return this.repository.save(newEntity);
  }

  public async appendItems(reportId: number, items: OfferBookRulesExecutionReportItemTypeormEntity[], batchSize: number = 200): Promise<void> {
    if (items.length === 0) return;
    const itemsRepository = this.dataSource.getRepository(OfferBookRulesExecutionReportItemTypeormEntity);
    items.forEach((item) => {
      item.executionReportId = reportId;
    });
    for (let i = 0; i < items.length; i += batchSize) {
      await itemsRepository.insert(items.slice(i, i + batchSize));
    }
  }

  public async updateHeader(
    id: number,
    fields: Pick<OfferBookRulesExecutionReportTypeormEntity, 'totalProducts' | 'productsUpdated' | 'productsSkipped' | 'outcome' | 'errorMessage'>
  ): Promise<void> {
    await this.repository.update(id, fields);
  }

  public async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  /**
   * Saves execution report with items in batches to avoid database parameter limits.
   * This method uses a transaction to ensure data consistency.
   *
   * @param entity - The OfferBookRulesExecutionReportTypeormEntity with all items
   * @param batchSize - Number of items to insert per batch (default: 1000)
   * @returns The saved entity (without items loaded)
   */
  public async saveWithBatchedItems(
    entity: OfferBookRulesExecutionReportTypeormEntity,
    batchSize: number = 1000
  ): Promise<OfferBookRulesExecutionReportTypeormEntity> {
    return this.dataSource.transaction(async (manager) => {
      // Extract items to insert separately
      const items = entity.items || [];

      // Remove items from entity to avoid cascade insert
      entity.items = [];

      // Save the main report entity
      const saved = await manager.save(OfferBookRulesExecutionReportTypeormEntity, entity);

      // Insert items in batches
      if (items.length > 0) {
        const itemsRepository = manager.getRepository(OfferBookRulesExecutionReportItemTypeormEntity);

        for (let i = 0; i < items.length; i += batchSize) {
          const batch = items.slice(i, i + batchSize);

          // Set the executionReportId for each item in the batch
          batch.forEach((item) => {
            item.executionReportId = saved.id;
          });

          // Insert the batch
          await itemsRepository.insert(batch);

          console.log(`Inserted report items batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);
        }

        console.log(`Successfully inserted ${items.length} report items in ${Math.ceil(items.length / batchSize)} batches`);
      }

      return saved;
    });
  }
}
