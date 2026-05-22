import {
  Inject,
  Injectable,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/jwt-payload.type';

@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
  private readonly payload: JwtPayload | null;

  constructor(@Inject(REQUEST) req: Request & { user?: JwtPayload }) {
    this.payload = req.user ?? null;
  }

  private require(): JwtPayload {
    if (!this.payload) throw new UnauthorizedException('No tenant context');
    return this.payload;
  }

  public get userId(): string {
    return this.require().sub;
  }

  public get tenantSlug(): string {
    return this.require().tenantId;
  }

  public get role(): JwtPayload['role'] {
    return this.require().role;
  }

  public get schemaName(): string {
    const slug = this.tenantSlug;
    return slug === 'system' ? 'system' : `tenant_${slug.replace(/-/g, '_')}`;
  }
}
