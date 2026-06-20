import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { applyMultiSort, SortDirection } from '../../dto/multi-sort';
import { OfferBookInfoTypeormEntity } from '../entities/offer-book-info.entity';
import { OfferBookInfoFilters } from '../../dto/get-offer-book-info-query-param.dto';

@Injectable()
export class OfferBookInfoRepository {
  constructor(private readonly repository: Repository<OfferBookInfoTypeormEntity>) {}

  public async findAll(): Promise<OfferBookInfoTypeormEntity[]> {
    return this.repository.find();
  }

  public async findById(id: number): Promise<OfferBookInfoTypeormEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  public async findPaginated(
    page: number,
    pageSize: number,
    filters: OfferBookInfoFilters,
    sortBy?: string[],
    sortDirection?: SortDirection[]
  ): Promise<[OfferBookInfoTypeormEntity[], number]> {
    const columnMap: Record<string, string> = {
      id: 'offer_book_info.id',
      name: 'offer_book_info.name',
      active: 'offer_book_info.active',
      startDate: 'offer_book_info.startDate',
      expirationDate: 'offer_book_info.expirationDate'
    };

    const queryBuilder = this.repository.createQueryBuilder('offer_book_info');

    if (filters.active !== undefined) {
      queryBuilder.andWhere('offer_book_info.active = :active', { active: filters.active });
    }

    if (filters.name) {
      queryBuilder.andWhere('offer_book_info.name ILIKE :name', { name: `%${filters.name}%` });
    }

    if (filters.startDate) {
      queryBuilder.andWhere('(DATE(offer_book_info.startDate) >= DATE(:startDate) OR offer_book_info.startDate IS NULL)', {
        startDate: filters.startDate
      });
    }

    if (filters.expirationDate) {
      queryBuilder.andWhere('(DATE(offer_book_info.expirationDate) >= DATE(:expirationDate) OR offer_book_info.expirationDate IS NULL)', {
        expirationDate: filters.expirationDate
      });
    }

    applyMultiSort(queryBuilder, sortBy, sortDirection, columnMap);

    queryBuilder.skip(((page <= 0 ? 1 : page) - 1) * pageSize).take(pageSize);

    return queryBuilder.getManyAndCount();
  }

  public async upsertBatch(entities: Partial<OfferBookInfoTypeormEntity>[]): Promise<void> {
    if (entities.length === 0) return;

    await this.repository.upsert(entities, ['externalId']);
  }
}
