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
import { ApplyPricesDto } from './dto/apply.dto';
import {
  ApplyReport,
  ApplyResponse,
  PricingApplyService,
} from './pricing-apply.service';

/**
 * Aplicação de preço em massa (Fase 3). POST cria o run e enfileira o push ao
 * ERP; GET reporta o andamento. Mutações exigem operator/admin.
 */
@Controller('pricing/apply')
export class PricingApplyController {
  constructor(private readonly apply: PricingApplyService) {}

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  @HttpCode(202)
  public create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ApplyPricesDto,
  ): Promise<ApplyResponse> {
    return this.apply.apply(em, user.tenantId, user.sub, dto);
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
