import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  CatalogService,
  IngredientGroup,
  Paginated,
  StockMetrics,
} from './catalog.service';
import { CatalogMutationService } from './catalog-mutation.service';
import { ListProductsQueryDto } from './dto/list-products.query';
import {
  UpdatePriceDto,
  UpdateProductDto,
  UpsertOfferDto,
} from './dto/update-product.dto';

/**
 * Tenant catalog — the authenticated tenant's own products. Scoped to the
 * caller's tenant by SearchPathInterceptor. Reads are open to any tenant
 * user; mutations require operator/admin (price/edit) or admin (delete).
 */
@Controller('products')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly mutations: CatalogMutationService,
  ) {}

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
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>> & { origins: string[] }> {
    return this.catalog.crossed(em, user.tenantId, query);
  }

  @Get('strategic-price')
  public strategicPrice(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    return this.catalog.strategicPrice(em, user.tenantId, query);
  }

  @Get('subsidiaries')
  public subsidiaries(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<Array<{ subsidiaryExternalId: string; label: string }>> {
    return this.catalog.subsidiaries(em, user.tenantId);
  }

  @Get('active-ingredients')
  public activeIngredients(
    @TenantEm() em: EntityManager,
  ): Promise<{ activeIngredients: string[] }> {
    return this.catalog
      .activeIngredients(em)
      .then((activeIngredients) => ({ activeIngredients }));
  }

  @Get('active-ingredients/crossed')
  public activeIngredientsCrossed(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<IngredientGroup>> {
    return this.catalog.activeIngredientsCrossed(em, user.tenantId, query);
  }

  @Get('active-ingredients/decision-counts')
  public decisionCounts(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<Record<string, number>> {
    return this.catalog.decisionCounts(em, user.tenantId, query);
  }

  @Get('generic-missing-active-ingredients')
  public genericMissing(
    @TenantEm() em: EntityManager,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<Record<string, unknown>>> {
    return this.catalog.genericMissing(em, query);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  public export(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ): Promise<string> {
    return this.catalog.exportCsv(em, user.tenantId, query);
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
  ): Promise<StockMetrics> {
    return this.catalog.stockMetrics(em, query);
  }

  @Patch(':ean')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @Param('ean') ean: string,
    @Body() dto: UpdateProductDto,
  ): Promise<{ ean: string; updated: number }> {
    this.assertEan(ean);
    return this.mutations.updateProduct(em, ean, dto);
  }

  @Post(':ean/price')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public updatePrice(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('ean') ean: string,
    @Body() dto: UpdatePriceDto,
  ): Promise<{ ean: string; price: number }> {
    this.assertEan(ean);
    return this.mutations.updatePrice(em, user.tenantId, ean, dto.newPrice);
  }

  @Post(':ean/offer')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public upsertOffer(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('ean') ean: string,
    @Body() dto: UpsertOfferDto,
  ): Promise<{ ean: string; targetPrice: number; cadernoId: number }> {
    this.assertEan(ean);
    return this.mutations.upsertOffer(em, user.tenantId, ean, dto);
  }

  @Delete(':ean/offer')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public removeOffer(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('ean') ean: string,
  ): Promise<{ ean: string; deleted: boolean }> {
    this.assertEan(ean);
    return this.mutations.removeOffer(em, user.tenantId, ean);
  }

  @Delete(':ean')
  @Roles(UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @Param('ean') ean: string,
  ): Promise<{ ean: string; deleted: boolean }> {
    this.assertEan(ean);
    return this.mutations.softDelete(em, ean);
  }

  private assertEan(ean: string): void {
    if (!/^\d+$/.test(ean))
      throw new BadRequestException('ean must be numeric');
  }
}
