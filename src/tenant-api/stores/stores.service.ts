import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { UpdateStoreDto, UpsertStoreClusterDto } from './dto/stores.dto';

export interface StoreApi {
  id: string;
  externalId: string;
  name: string;
  cnpj: string | null;
  active: boolean;
  clusterId: string | null;
  clusterName: string | null;
}

export interface StoreClusterApi {
  id: string;
  name: string;
  storeCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tenant-admin store & cluster management. Stores and clusters live in
 * `core` keyed by tenant_id; every query resolves the tenant uuid from the
 * caller's slug and scopes by it (the request em reads/writes `core` via its
 * explicit schema, regardless of search_path).
 */
@Injectable()
export class StoresService {
  public async listStores(
    em: EntityManager,
    slug: string,
  ): Promise<StoreApi[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: StoreRow[] = await em.query(
      `SELECT s.id, s.external_id::text AS "externalId", s.name, s.cnpj,
              s.active, s.cluster_id AS "clusterId", cl.name AS "clusterName"
         FROM core.tenant_store s
         LEFT JOIN core.store_cluster cl
           ON cl.id = s.cluster_id AND cl.deleted_at IS NULL
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
        ORDER BY s.name`,
      [tenantId],
    );
    return rows.map(mapStore);
  }

  public async updateStore(
    em: EntityManager,
    slug: string,
    id: string,
    dto: UpdateStoreDto,
  ): Promise<StoreApi> {
    if (dto.active === undefined && dto.clusterId === undefined) {
      throw new BadRequestException('no fields to update');
    }
    const tenantId = await resolveTenantId(em, slug);
    if (dto.clusterId) await this.assertCluster(em, tenantId, dto.clusterId);

    const sets: string[] = [];
    const params: unknown[] = [id, tenantId];
    if (dto.active !== undefined) {
      sets.push(`active = $${params.push(dto.active)}`);
    }
    if (dto.clusterId !== undefined) {
      sets.push(`cluster_id = $${params.push(dto.clusterId)}`);
    }
    const res: Array<{ id: string }> = await em.query(
      `UPDATE core.tenant_store
          SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      params,
    );
    if (!res.length) throw new NotFoundException(`store ${id} not found`);
    const stores = await this.listStores(em, slug);
    return stores.find((s) => s.id === id)!;
  }

  public async listClusters(
    em: EntityManager,
    slug: string,
  ): Promise<StoreClusterApi[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: ClusterRow[] = await em.query(
      `SELECT c.id, c.name, count(s.id) AS "storeCount",
              c.created_at AS "createdAt", c.updated_at AS "updatedAt"
         FROM core.store_cluster c
         LEFT JOIN core.tenant_store s
           ON s.cluster_id = c.id AND s.deleted_at IS NULL
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.name`,
      [tenantId],
    );
    return rows.map(mapCluster);
  }

  public async createCluster(
    em: EntityManager,
    slug: string,
    dto: UpsertStoreClusterDto,
  ): Promise<StoreClusterApi> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ id: string }> = await em.query(
      `INSERT INTO core.store_cluster (tenant_id, name)
       VALUES ($1, $2) RETURNING id`,
      [tenantId, dto.name.trim()],
    );
    return (await this.listClusters(em, slug)).find(
      (c) => c.id === rows[0].id,
    )!;
  }

  public async renameCluster(
    em: EntityManager,
    slug: string,
    id: string,
    dto: UpsertStoreClusterDto,
  ): Promise<StoreClusterApi> {
    const tenantId = await resolveTenantId(em, slug);
    const res: Array<{ id: string }> = await em.query(
      `UPDATE core.store_cluster SET name = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING id`,
      [id, tenantId, dto.name.trim()],
    );
    if (!res.length) throw new NotFoundException(`cluster ${id} not found`);
    return (await this.listClusters(em, slug)).find((c) => c.id === id)!;
  }

  /** Soft-delete the cluster. Member stores keep their row; cluster_id is
   *  cleared so they don't dangle to a deleted cluster. */
  public async deleteCluster(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<{ id: string; name: string }> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ name: string }> = await em.query(
      `UPDATE core.store_cluster SET deleted_at = now(), updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        RETURNING name`,
      [id, tenantId],
    );
    if (!rows.length) throw new NotFoundException(`cluster ${id} not found`);
    await em.query(
      `UPDATE core.tenant_store SET cluster_id = NULL, updated_at = now()
        WHERE cluster_id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return { id, name: rows[0].name };
  }

  private async assertCluster(
    em: EntityManager,
    tenantId: string,
    clusterId: string,
  ): Promise<void> {
    const rows: unknown[] = await em.query(
      `SELECT 1 FROM core.store_cluster
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
      [clusterId, tenantId],
    );
    if (!rows.length) {
      throw new NotFoundException(`cluster ${clusterId} not found`);
    }
  }
}

interface StoreRow {
  id: string;
  externalId: string;
  name: string;
  cnpj: string | null;
  active: boolean;
  clusterId: string | null;
  clusterName: string | null;
}

interface ClusterRow {
  id: string;
  name: string;
  storeCount: string;
  createdAt: Date;
  updatedAt: Date;
}

function mapStore(r: StoreRow): StoreApi {
  return {
    id: r.id,
    externalId: r.externalId,
    name: r.name,
    cnpj: r.cnpj,
    active: r.active,
    clusterId: r.clusterId,
    clusterName: r.clusterName,
  };
}

function mapCluster(r: ClusterRow): StoreClusterApi {
  return {
    id: r.id,
    name: r.name,
    storeCount: Number(r.storeCount),
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  };
}
