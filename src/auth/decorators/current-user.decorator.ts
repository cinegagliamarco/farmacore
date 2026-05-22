import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../jwt-payload.type';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return req.user;
  },
);
