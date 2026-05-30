import type { UserRole } from '../database/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
