import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { AuditService } from './audit.service';
import { ApplyPricesDto, PreviewApplyDto } from './dto/apply.dto';
import {
  ApplyPreview,
  ApplyReport,
  ApplyResponse,
  ApplyRunSummary,
  PricingApplyService,
} from './pricing-apply.service';

/**
 * Aplicação de preço em massa (Fase 3). POST cria o run e enfileira o push ao
 * ERP; GET reporta o andamento. Mutações exigem operator/admin.
 */
@Controller('pricing/apply')
export class PricingApplyController {
  constructor(
    private readonly apply: PricingApplyService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @HttpCode(202)
  public async create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApplyPricesDto,
  ): Promise<ApplyResponse> {
    const res = await this.apply.apply(em, user.tenantId, user.sub, dto);
    if (!res.idempotent) {
      await this.audit.log(em, {
        actor: user.sub,
        action: 'apply',
        entity: 'apply_run',
        entityId: res.applyRunId,
        changes: { accepted: res.accepted, rejected: res.rejected.length },
      });
    }
    return res;
  }

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<ApplyRunSummary[]> {
    return this.apply.list(
      em,
      page ? Number(page) : undefined,
      perPage ? Number(perPage) : undefined,
    );
  }

  @Post('preview')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @HttpCode(200)
  public preview(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: PreviewApplyDto,
  ): Promise<ApplyPreview> {
    return this.apply.preview(em, user.tenantId, dto.items);
  }

  @Post(':id/rollback')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @HttpCode(202)
  public async rollback(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplyResponse> {
    const res = await this.apply.rollback(em, user.tenantId, user.sub, id);
    if (!res.idempotent) {
      await this.audit.log(em, {
        actor: user.sub,
        action: 'rollback',
        entity: 'apply_run',
        entityId: res.applyRunId,
        changes: { sourceRunId: id, accepted: res.accepted },
      });
    }
    return res;
  }

  @Get(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public report(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<ApplyReport> {
    return this.apply.report(
      em,
      id,
      page ? Number(page) : undefined,
      perPage ? Number(perPage) : undefined,
    );
  }
}
