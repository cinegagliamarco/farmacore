import { Injectable, NotFoundException } from '@nestjs/common';
import { OfferBookRulesExecutionReportRepository } from '../database/repositories/offer-book-rules-execution-report.repository';
import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';
import { PaginatedExecutionReportResponseDto } from '../dto/execution-report-response.dto';

@Injectable()
export class GetExecutionReportUseCase {
  constructor(private readonly executionReportRepository: OfferBookRulesExecutionReportRepository) {}

  public async execute(id: number): Promise<OfferBookRulesExecutionReportTypeormEntity> {
    const report = await this.executionReportRepository.findById(id);

    if (!report) {
      throw new NotFoundException(`Execution report with ID ${id} not found`);
    }

    return report;
  }

  public async executeWithPagination(id: number, page: number, perPage: number, nameFilter?: string): Promise<PaginatedExecutionReportResponseDto> {
    const { report, items, totalItems } = await this.executionReportRepository.findByIdWithPaginatedItems(id, page, perPage, nameFilter);

    if (!report) {
      throw new NotFoundException(`Execution report with ID ${id} not found`);
    }

    const totalPages = Math.ceil(totalItems / perPage);

    return {
      report,
      items,
      totalItems,
      page,
      perPage,
      totalPages
    };
  }
}
