import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRED_MODULES_KEY } from '../decorators/require-module.decorator';
import type { TenantEntity } from '../../database/entities/core/tenant.entity';
import { TenantStatus } from '../../database/enums/tenant-status.enum';
import type { ModuleCode } from '../../database/enums/module-code.enum';
import type { JwtPayload } from '../jwt-payload.type';
import { TenantService } from '../../tenant/tenant.service';

@Injectable()
export class ModulesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenants: TenantService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ModuleCode[]>(
      REQUIRED_MODULES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('Missing user');
    // System admin ('system' é slug reservado) não é sujeito a gating.
    if (user.tenantId === 'system') return true;
    let tenant: TenantEntity;
    try {
      tenant = await this.tenants.findBySlug(user.tenantId);
    } catch (e) {
      // Tenant offboardado (soft-delete) com token ainda válido: 403, não 404.
      if (e instanceof NotFoundException)
        throw new ForbiddenException('Tenant offboarded');
      throw e;
    }
    // Access tokens outlive a suspension by up to 1h; gate them here too.
    if (tenant.status !== TenantStatus.ACTIVE)
      throw new ForbiddenException('Tenant not active');
    if (!required.some((m) => tenant.modules.includes(m)))
      throw new ForbiddenException(
        `Module not enabled for tenant: ${required.join(' or ')}`,
      );
    return true;
  }
}
