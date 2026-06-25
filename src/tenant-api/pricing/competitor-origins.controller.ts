import { Controller, Get, Header } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CompetitorOriginsService,
  CompetitorOriginConfig,
} from './competitor-origins.service';

@Controller('pricing/competitor-origins')
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
