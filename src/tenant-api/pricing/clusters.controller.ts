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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequireModule } from '../../auth/decorators/require-module.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { JwtPayload } from '../../auth/jwt-payload.type';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { UserRole } from '../../database/enums/user-role.enum';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import { AuditService } from './audit.service';
import { ClusterApi, ClustersService } from './clusters.service';
import { UpsertClusterDto } from './dto/cluster.dto';

/**
 * Clusters de produto do tenant — conjuntos de EANs para mirar regras de preço.
 * Leitura e mutação exigem operator/admin. Mutações registram auditoria.
 */
@Controller('pricing/clusters')
@RequireModule(ModuleCode.PRICING_RULES)
export class ClustersController {
  constructor(
    private readonly clusters: ClustersService,
    private readonly audit: AuditService,
  ) {}

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
  public async create(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    const cluster = await this.clusters.create(em, dto);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'create',
      entity: 'cluster',
      entityId: cluster.id,
      changes: { name: dto.name, eanCount: dto.eans?.length ?? 0 },
    });
    return cluster;
  }

  @Patch(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public async update(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    const cluster = await this.clusters.update(em, id, dto);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'update',
      entity: 'cluster',
      entityId: id,
      changes: { name: dto.name, eanCount: dto.eans?.length },
    });
    return cluster;
  }

  @Delete(':id')
  @Roles(UserRole.OPERATOR, UserRole.ADMIN)
  public async remove(
    @TenantEm() em: EntityManager,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; name: string }> {
    const res = await this.clusters.remove(em, id);
    await this.audit.log(em, {
      actor: user.sub,
      action: 'delete',
      entity: 'cluster',
      entityId: id,
    });
    return res;
  }
}
