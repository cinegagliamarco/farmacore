import { Controller, Get } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CompetitorOriginsService,
  CompetitorOriginView,
} from './competitor-origins.service';

/**
 * Origens de concorrente do tenant (somente leitura). A UI usa isto para o
 * seletor de concorrentes da regra; as origens em si são geridas no /admin.
 */
@Controller('pricing/competitor-origins')
export class CompetitorOriginsController {
  constructor(private readonly origins: CompetitorOriginsService) {}

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<CompetitorOriginView[]> {
    return this.origins.list(em, user.tenantId);
  }
}
