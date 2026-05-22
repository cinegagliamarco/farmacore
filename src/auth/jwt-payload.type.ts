import type { UserRole } from '../database/entities/core/user.entity';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
