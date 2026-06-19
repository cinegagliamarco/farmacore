import { Controller, Get, Query } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { CatalogService, Paginated } from './catalog.service';
import { ListProductsQueryDto } from './dto/list-products.query';

/**
 * Tenant catalog reads — the authenticated tenant's own products. Scoped
 * to the caller's tenant by SearchPathInterceptor (no admin guard); any
 * authenticated tenant user (viewer/operator/admin) may read.
 */
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  public list(
    @TenantEm() em: EntityManager,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    return this.catalog.list(em, query);
  }

  @Get('crossed')
  public crossed(
    @TenantEm() em: EntityManager,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    return this.catalog.crossed(em, query);
  }

  @Get('stock')
  public stock(
    @TenantEm() em: EntityManager,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    return this.catalog.stock(em, query);
  }

  @Get('stock-metrics')
  public stockMetrics(
    @TenantEm() em: EntityManager,
    @Query() query: ListProductsQueryDto,
  ): Promise<Record<string, number>> {
    return this.catalog.stockMetrics(em, query);
  }
}
