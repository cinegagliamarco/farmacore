import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';
import { OfferBookRulesExecutionReportItemTypeormEntity } from '../database/entities/offer-book-rules-execution-report-item.entity';

export class PaginatedExecutionReportResponseDto {
  public report: OfferBookRulesExecutionReportTypeormEntity;
  public items: OfferBookRulesExecutionReportItemTypeormEntity[];
  public totalItems: number;
  public page: number;
  public perPage: number;
  public totalPages: number;
}
