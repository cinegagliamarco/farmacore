import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * The tenant-scoped EntityManager for the current request — the one
 * SearchPathInterceptor opened with `search_path` set to the JWT's tenant
 * schema (+ shared_catalog + public). Tenant-API handlers/services use it
 * so unqualified table names resolve to the caller's tenant schema.
 */
export const TenantEm = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EntityManager => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ entityManager?: EntityManager }>();
    if (!req.entityManager) {
      throw new InternalServerErrorException(
        'No tenant EntityManager on request',
      );
    }
    return req.entityManager;
  },
);
