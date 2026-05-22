import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { TenantContext } from '../tenant.context';
import { TenantTransactionService } from '../tenant-transaction.service';

@Injectable()
export class SearchPathInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantContext: TenantContext,
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
      .getRequest<Request & { entityManager?: EntityManager }>();
    const schemaName = this.tenantContext.schemaName;

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
