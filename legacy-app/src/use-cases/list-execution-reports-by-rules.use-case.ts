import { Injectable } from '@nestjs/common';
import { OfferBookRulesExecutionReportRepository } from '../database/repositories/offer-book-rules-execution-report.repository';
import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';

@Injectable()
export class ListExecutionReportsByRulesUseCase {
  constructor(private readonly executionReportRepository: OfferBookRulesExecutionReportRepository) {}

  public async execute(
    offerBookRulesId: number,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ rows: OfferBookRulesExecutionReportTypeormEntity[]; count: number }> {
    const [rows, count] = await this.executionReportRepository.findPaginatedByRulesId(offerBookRulesId, page, pageSize);
    return { rows, count };
  }
}
