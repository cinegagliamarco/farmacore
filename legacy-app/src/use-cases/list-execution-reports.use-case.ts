import { Injectable } from '@nestjs/common';
import {
  OfferBookRulesExecutionReportRepository,
  ExecutionReportFilters
} from '../database/repositories/offer-book-rules-execution-report.repository';
import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';

@Injectable()
export class ListExecutionReportsUseCase {
  constructor(private readonly executionReportRepository: OfferBookRulesExecutionReportRepository) {}

  public async execute(
    filters: ExecutionReportFilters,
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ rows: OfferBookRulesExecutionReportTypeormEntity[]; count: number }> {
    const [rows, count] = await this.executionReportRepository.findPaginated(page, pageSize, filters);
    return { rows, count };
  }
}
