import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { ClusterApi, ClustersService } from './clusters.service';
import { UpsertClusterDto } from './dto/cluster.dto';

/**
 * Clusters de produto do tenant — conjuntos de EANs para mirar regras de preço.
 * Leitura aberta; mutações exigem operator/admin.
 */
@Controller('pricing/clusters')
export class ClustersController {
  constructor(private readonly clusters: ClustersService) {}

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public list(@TenantEm() em: EntityManager): Promise<ClusterApi[]> {
    return this.clusters.list(em);
  }

  @Get(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public get(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClusterApi & { eans: string[] }> {
    return this.clusters.get(em, id);
  }

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public create(
    @TenantEm() em: EntityManager,
    @Body() dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    return this.clusters.create(em, dto);
  }

  @Patch(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public update(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    return this.clusters.update(em, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public remove(
    @TenantEm() em: EntityManager,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; name: string }> {
    return this.clusters.remove(em, id);
  }
}
