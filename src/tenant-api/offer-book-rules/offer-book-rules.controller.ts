import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CreateOfferBookRuleDto,
  ListExecutionReportsQueryDto,
  ListOfferBookRulesQueryDto,
  PaginatedQueryDto,
  UpdateOfferBookRuleDto,
} from './dto/offer-book-rule.dto';
import {
  PaginatedPreviewResult,
  PreviewOfferBookRulesDto,
} from './dto/preview-offer-book-rules.dto';
import {
  OfferBookRuleDetail,
  OfferBookRulesManagementService,
} from './offer-book-rules-management.service';
import { OfferBookRulesService } from './offer-book-rules.service';

@Controller('offer-book-rules')
export class OfferBookRulesController {
  constructor(
    private readonly rules: OfferBookRulesService,
    private readonly mgmt: OfferBookRulesManagementService,
  ) {}

  // ----- collection -----

  @Get()
  public list(
    @TenantEm() em: EntityManager,
    @Query() query: ListOfferBookRulesQueryDto,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    return this.mgmt.list(em, query);
  }

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @Body() dto: CreateOfferBookRuleDto,
  ): Promise<OfferBookRuleDetail> {
    return this.mgmt.create(em, dto);
  }

  /** Ad-hoc preview (unsaved rule config). */
  @Post('preview')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public preview(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PreviewOfferBookRulesDto,
  ): Promise<PaginatedPreviewResult> {
    return this.rules.preview(em, user.tenantId, dto);
  }

  @Post('preview-download')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @Header('Content-Type', 'text/csv')
  @Header(
    'Content-Disposition',
    'attachment; filename="offer-book-rules-preview.csv"',
  )
  public previewDownload(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PreviewOfferBookRulesDto,
  ): Promise<string> {
    return this.mgmt.downloadPreviewAdhoc(em, user.tenantId, dto);
  }

  // ----- execution reports (static routes before :id) -----

  @Get('execution-reports')
  public listExecutionReports(
    @TenantEm() em: EntityManager,
    @Query() query: ListExecutionReportsQueryDto,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    return this.mgmt.listReports(em, query);
  }

  @Get('execution-reports/:id')
  public getExecutionReport(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedQueryDto,
  ): Promise<Record<string, unknown>> {
    return this.mgmt.getReport(em, id, query.page, query.pageSize, query.name);
  }

  // ----- saved-rule sub-resources -----

  @Get(':id/preview')
  public previewSaved(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedQueryDto,
  ): Promise<PaginatedPreviewResult> {
    return this.mgmt.previewSaved(
      em,
      user.tenantId,
      id,
      query.page,
      query.pageSize,
    );
  }

  @Get(':id/products')
  public products(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedQueryDto,
  ): Promise<unknown> {
    return this.mgmt.getProducts(
      em,
      user.tenantId,
      id,
      query.page,
      query.pageSize,
    );
  }

  @Get(':id/preview-download')
  @Header('Content-Type', 'text/csv')
  @Header(
    'Content-Disposition',
    'attachment; filename="offer-book-rule-preview.csv"',
  )
  public previewSavedDownload(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string> {
    return this.mgmt.downloadPreviewSaved(em, user.tenantId, id);
  }

  @Get(':id/execution-reports')
  public listExecutionReportsByRule(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginatedQueryDto,
  ): Promise<{ rows: Array<Record<string, unknown>>; count: number }> {
    return this.mgmt.listReportsByRule(em, id, query.page, query.pageSize);
  }

  // ----- item routes -----

  @Get(':id')
  public getById(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OfferBookRuleDetail> {
    return this.mgmt.getById(em, id);
  }

  @Patch(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOfferBookRuleDto,
  ): Promise<OfferBookRuleDetail> {
    return this.mgmt.update(em, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; deleted: boolean }> {
    return this.mgmt.remove(em, id);
  }
}
