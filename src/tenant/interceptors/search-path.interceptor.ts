import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { TenantTransactionService } from '../tenant-transaction.service';
import { schemaNameFor } from '../tenant-schema';

@Injectable()
export class SearchPathInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly txService: TenantTransactionService,
  ) {}

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();
    if (context.getType<string>() !== 'http') return next.handle();

    const req = context
      .switchToHttp()
      .getRequest<
        Request & { user?: JwtPayload; entityManager?: EntityManager }
      >();
    if (!req.user) throw new UnauthorizedException('No tenant context');
    const schemaName = schemaNameFor(req.user.tenantId);
    // System/admin routes never read req.entityManager; skip the transaction
    // so they don't hold a pool connection for the whole request.
    if (schemaName === 'system') return next.handle();

    return from(
      this.txService.runWithTenant(schemaName, async (em) => {
        req.entityManager = em;
        return new Promise<unknown>((resolve, reject) => {
          next.handle().subscribe({ next: resolve, error: reject });
        });
      }),
    );
  }
}
