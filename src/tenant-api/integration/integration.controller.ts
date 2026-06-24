import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';

/**
 * Lets a tenant's own admin check whether their ERP database connection is
 * working — scoped to the caller's tenant via the JWT, admin-only. Returns a
 * sanitized result (no raw driver error): the connection host/credentials are
 * Farmacore-managed infra. Fleet-wide and raw-error views live under /admin.
 */
@Controller('integration')
export class TenantIntegrationController {
  constructor(private readonly svc: IntegrationConnectionService) {}

  @Get('health')
  @Roles(UserRole.ADMIN)
  public health(
    @CurrentUser() user: JwtPayload,
  ): Promise<{ ok: boolean; lastVerifiedAt: Date | null }> {
    return this.svc.testForTenant(user.tenantId);
  }
}
