import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../../auth/jwt-payload.type';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (user.tenantId !== 'system' || user.role !== 'admin') {
      throw new ForbiddenException('System admin required');
    }
    return true;
  }
}
