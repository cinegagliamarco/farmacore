import { Controller, Get, Header } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequireModule } from '../../auth/decorators/require-module.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CompetitorOriginsService,
  CompetitorOriginConfig,
} from './competitor-origins.service';

// Alimenta a tela de produtos cruzados e os formulários de regras de preço.
@Controller('pricing/competitor-origins')
@RequireModule(ModuleCode.CROSSED_PRODUCTS, ModuleCode.PRICING_RULES)
export class CompetitorOriginsController {
  constructor(private readonly origins: CompetitorOriginsService) {}

  @Get()
  @Roles(UserRole.VIEWER, UserRole.OPERATOR, UserRole.ADMIN)
  @Header('Cache-Control', 'private, max-age=300')
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<CompetitorOriginConfig[]> {
    return this.origins.list(em, user.tenantId);
  }
}
