import { CustomDecorator, SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../database/entities/core/user.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);
