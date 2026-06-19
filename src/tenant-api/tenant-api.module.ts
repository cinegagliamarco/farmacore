import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';

/**
 * Tenant-user-facing API (the FE's surface). Every route is tenant-scoped
 * by the global SearchPathInterceptor + JwtAuthGuard — no admin guard.
 * System operations live under /admin instead.
 */
@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class TenantApiModule {}
