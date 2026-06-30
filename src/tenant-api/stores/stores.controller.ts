import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { UpdateStoreDto, UpsertStoreClusterDto } from './dto/stores.dto';
import { StoreApi, StoreClusterApi, StoresService } from './stores.service';

/**
 * Tenant-admin store management. Stores are synced from the ERP (active=false
 * by default); the admin toggles `active` (opt-in to per-store pricing) and
 * attaches a store to a cluster.
 */
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<StoreApi[]> {
    return this.stores.listStores(em, user.tenantId);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreDto,
  ): Promise<StoreApi> {
    return this.stores.updateStore(em, user.tenantId, id, dto);
  }
}

/** Tenant-admin store-cluster CRUD (groups of stores). */
@Controller('store-clusters')
export class StoreClustersController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  public list(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
  ): Promise<StoreClusterApi[]> {
    return this.stores.listClusters(em, user.tenantId);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertStoreClusterDto,
  ): Promise<StoreClusterApi> {
    return this.stores.createCluster(em, user.tenantId, dto);
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  public rename(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertStoreClusterDto,
  ): Promise<StoreClusterApi> {
    return this.stores.renameCluster(em, user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; name: string }> {
    return this.stores.deleteCluster(em, user.tenantId, id);
  }
}
