import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateOfferBookRulesBodyDto,
  PreviewOfferBookRulesBodyDto,
  PaginatedPreviewProductResult,
  UpdateOfferBookRulesBodyDto,
  PaginatedOfferBookRuleProductResult
} from '../dto/offer-book-rules-body.dto';
import {
  GetOfferBookRulesQueryParamDto,
  PreviewSavedOfferBookRulesQueryParamDto,
  GetOfferBookRuleProductsQueryParamDto
} from '../dto/offer-book-rules-query-param.dto';
import { GetExecutionReportsQueryParamDto } from '../dto/get-execution-reports-query-param.dto';
import { GetRuleExecutionReportsQueryParamDto } from '../dto/get-rule-execution-reports-query-param.dto';
import { GetExecutionReportQueryParamDto } from '../dto/get-execution-report-query-param.dto';
import { PaginatedExecutionReportResponseDto } from '../dto/execution-report-response.dto';
import { CreateOfferBookRulesUseCase } from '../use-cases/create-offer-book-rules.use-case';
import { DeleteOfferBookRulesUseCase } from '../use-cases/delete-offer-book-rules.use-case';
import { ExecuteOfferBookRulesUseCase, StartExecuteOfferBookRulesResult } from '../use-cases/execute-offer-book-rules.use-case';
import { GetOfferBookRulesUseCase } from '../use-cases/get-offer-book-rules.use-case';
import { ListOfferBookRulesUseCase } from '../use-cases/list-offer-book-rules.use-case';
import { PreviewOfferBookRulesUseCase } from '../use-cases/preview-offer-book-rules.use-case';
import { PreviewSavedOfferBookRulesUseCase } from '../use-cases/preview-saved-offer-book-rules.use-case';
import { UpdateOfferBookRulesUseCase } from '../use-cases/update-offer-book-rules.use-case';
import { ListExecutionReportsUseCase } from '../use-cases/list-execution-reports.use-case';
import { GetExecutionReportUseCase } from '../use-cases/get-execution-report.use-case';
import { ListExecutionReportsByRulesUseCase } from '../use-cases/list-execution-reports-by-rules.use-case';
import { DownloadPreviewOfferBookRulesUseCase } from '../use-cases/download-preview-offer-book-rules.use-case';
import { DownloadPreviewSavedOfferBookRulesUseCase } from '../use-cases/download-preview-saved-offer-book-rules.use-case';
import { GetOfferBookRuleProductsUseCase } from '../use-cases/get-offer-book-rule-products.use-case';
import { OfferBookRulesTypeormEntity } from '../database/entities/offer-book-rules.entity';
import { OfferBookRulesExecutionReportTypeormEntity } from '../database/entities/offer-book-rules-execution-report.entity';

@Controller('offer-book-rules')
export class OfferBookRulesController {
  constructor(
    private readonly createOfferBookRulesUseCase: CreateOfferBookRulesUseCase,
    private readonly getOfferBookRulesUseCase: GetOfferBookRulesUseCase,
    private readonly listOfferBookRulesUseCase: ListOfferBookRulesUseCase,
    private readonly previewOfferBookRulesUseCase: PreviewOfferBookRulesUseCase,
    private readonly previewSavedOfferBookRulesUseCase: PreviewSavedOfferBookRulesUseCase,
    private readonly executeOfferBookRulesUseCase: ExecuteOfferBookRulesUseCase,
    private readonly updateOfferBookRulesUseCase: UpdateOfferBookRulesUseCase,
    private readonly deleteOfferBookRulesUseCase: DeleteOfferBookRulesUseCase,
    private readonly listExecutionReportsUseCase: ListExecutionReportsUseCase,
    private readonly getExecutionReportUseCase: GetExecutionReportUseCase,
    private readonly listExecutionReportsByRulesUseCase: ListExecutionReportsByRulesUseCase,
    private readonly downloadPreviewOfferBookRulesUseCase: DownloadPreviewOfferBookRulesUseCase,
    private readonly downloadPreviewSavedOfferBookRulesUseCase: DownloadPreviewSavedOfferBookRulesUseCase,
    private readonly getOfferBookRuleProductsUseCase: GetOfferBookRuleProductsUseCase
  ) {}

  @Get()
  public list(@Query() query: GetOfferBookRulesQueryParamDto): Promise<{ rows: OfferBookRulesTypeormEntity[]; count: number }> {
    return this.listOfferBookRulesUseCase.execute(query);
  }

  @Post()
  public create(@Body() dto: CreateOfferBookRulesBodyDto): Promise<OfferBookRulesTypeormEntity> {
    return this.createOfferBookRulesUseCase.execute(dto);
  }

  @Post('preview')
  public preview(@Body() dto: PreviewOfferBookRulesBodyDto): Promise<PaginatedPreviewProductResult> {
    return this.previewOfferBookRulesUseCase.execute(dto);
  }

  @Post('preview-download')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="preview-offer-book-rules.csv"')
  public async previewDownload(@Body() dto: PreviewOfferBookRulesBodyDto): Promise<string> {
    return this.downloadPreviewOfferBookRulesUseCase.execute(dto);
  }

  @Get('execution-reports')
  public listExecutionReports(
    @Query() query: GetExecutionReportsQueryParamDto
  ): Promise<{ rows: OfferBookRulesExecutionReportTypeormEntity[]; count: number }> {
    const { page = 1, perPage = 20, offerBookRulesId, offerBookInfoId, executionType, outcome, startDate, endDate } = query;

    return this.listExecutionReportsUseCase.execute(
      {
        offerBookRulesId,
        offerBookInfoId,
        executionType,
        outcome,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined
      },
      page,
      perPage
    );
  }

  @Get('execution-reports/:id')
  public getExecutionReport(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetExecutionReportQueryParamDto
  ): Promise<PaginatedExecutionReportResponseDto> {
    const { page, perPage, name } = query;
    return this.getExecutionReportUseCase.executeWithPagination(id, page, perPage, name);
  }

  @Get(':id/preview')
  public previewSaved(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PreviewSavedOfferBookRulesQueryParamDto
  ): Promise<PaginatedPreviewProductResult> {
    const { page = 1, perPage = 1000 } = query;
    return this.previewSavedOfferBookRulesUseCase.execute(id, page, perPage);
  }

  @Get(':id/products')
  public getProducts(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetOfferBookRuleProductsQueryParamDto
  ): Promise<PaginatedOfferBookRuleProductResult> {
    const { page = 1, perPage = 300, name } = query;
    return this.getOfferBookRuleProductsUseCase.execute(id, page, perPage, name);
  }

  @Get(':id/preview-download')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="preview-offer-book-rules.csv"')
  public async previewSavedDownload(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.downloadPreviewSavedOfferBookRulesUseCase.execute(id);
  }

  @Post(':id/execute')
  public execute(@Param('id', ParseIntPipe) id: number): Promise<StartExecuteOfferBookRulesResult> {
    return this.executeOfferBookRulesUseCase.startExecution(id);
  }

  @Get(':id/execution-reports')
  public getExecutionReportsByRulesId(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: GetRuleExecutionReportsQueryParamDto
  ): Promise<{ rows: OfferBookRulesExecutionReportTypeormEntity[]; count: number }> {
    const { page = 1, perPage = 20 } = query;
    return this.listExecutionReportsByRulesUseCase.execute(id, page, perPage);
  }

  @Get(':id')
  public getById(@Param('id', ParseIntPipe) id: number): Promise<OfferBookRulesTypeormEntity> {
    return this.getOfferBookRulesUseCase.execute(id);
  }

  @Patch(':id')
  public update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOfferBookRulesBodyDto): Promise<OfferBookRulesTypeormEntity> {
    return this.updateOfferBookRulesUseCase.execute(id, dto);
  }

  @Delete(':id')
  public delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.deleteOfferBookRulesUseCase.execute(id);
  }
}
