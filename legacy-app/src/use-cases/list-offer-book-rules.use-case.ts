import { Injectable } from '@nestjs/common';
import { OfferBookRulesRepository } from '../database/repositories/offer-book-rules.repository';
import { GetOfferBookRulesQueryParamDto } from '../dto/offer-book-rules-query-param.dto';
import { OfferBookRulesTypeormEntity } from '../database/entities/offer-book-rules.entity';

@Injectable()
export class ListOfferBookRulesUseCase {
  constructor(private readonly offerBookRulesRepository: OfferBookRulesRepository) {}

  public async execute(filters: GetOfferBookRulesQueryParamDto): Promise<{ rows: OfferBookRulesTypeormEntity[]; count: number }> {
    const [rows, count] = await this.offerBookRulesRepository.findPaginated(filters.page, filters.perPage, filters);
    return { rows, count };
  }
}
