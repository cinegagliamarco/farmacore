import { Injectable } from '@nestjs/common';
import { GetOfferBookInfoQueryParamDto } from '../dto/get-offer-book-info-query-param.dto';
import { OfferBookInfoRepository } from '../database/repositories/offer-book-info.repository';
import { OfferBookInfoTypeormEntity } from '../database/entities/offer-book-info.entity';

@Injectable()
export class GetOfferBooksInfoUseCase {
  constructor(private readonly offerBookInfoRepository: OfferBookInfoRepository) {}

  public async execute(filters: GetOfferBookInfoQueryParamDto): Promise<{ rows: Partial<OfferBookInfoTypeormEntity>[]; count: number }> {
    const [rows, count] = await this.offerBookInfoRepository.findPaginated(
      filters.page,
      filters.perPage,
      filters,
      filters.sortBy,
      filters.sortDirection
    );
    return {
      rows: rows.map((row) => ({
        id: row.id,
        externalId: row.externalId,
        name: row.name,
        active: row.active,
        startDate: row.startDate,
        expirationDate: row.expirationDate
      })),
      count
    };
  }
}
