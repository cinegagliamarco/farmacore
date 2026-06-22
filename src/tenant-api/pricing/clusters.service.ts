import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UpsertClusterDto } from './dto/cluster.dto';

export interface ClusterApi {
  id: string;
  name: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

const MAX_MEMBERS = 5000;
const EAN_RE = /^\d{6,14}$/;

/**
 * CRUD dos clusters de produto (`product_cluster` + `product_cluster_member`,
 * schema do tenant). Membership estática (manual/CSV). Port do pricy-shelf
 * `product-clusters-store.ts`. Roda dentro da transação do request (o
 * SearchPathInterceptor já abre uma) — sem transação aninhada explícita.
 */
@Injectable()
export class ClustersService {
  public async list(em: EntityManager): Promise<ClusterApi[]> {
    const rows: Array<{
      id: string;
      name: string;
      memberCount: string;
      createdAt: Date;
      updatedAt: Date;
    }> = await em.query(
      `SELECT c.id, c.name,
              count(m.cluster_id) AS "memberCount",
              c.created_at AS "createdAt", c.updated_at AS "updatedAt"
         FROM product_cluster c
         LEFT JOIN product_cluster_member m ON m.cluster_id = c.id
        WHERE c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY c.updated_at DESC`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      memberCount: Number(r.memberCount),
      createdAt: new Date(r.createdAt).toISOString(),
      updatedAt: new Date(r.updatedAt).toISOString(),
    }));
  }

  public async get(
    em: EntityManager,
    id: string,
  ): Promise<ClusterApi & { eans: string[] }> {
    const cluster = (await this.list(em)).find((c) => c.id === id);
    if (!cluster) throw new NotFoundException(`cluster ${id} not found`);
    const members: Array<{ ean: string }> = await em.query(
      `SELECT ean FROM product_cluster_member WHERE cluster_id = $1 ORDER BY ean`,
      [id],
    );
    return { ...cluster, eans: members.map((m) => m.ean) };
  }

  public async create(
    em: EntityManager,
    dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    const eans = this.normalizeEans(dto.eans);
    const [{ id }]: Array<{ id: string }> = await em.query(
      `INSERT INTO product_cluster (name) VALUES ($1) RETURNING id`,
      [dto.name.trim()],
    );
    if (eans.length) await this.replaceMembers(em, id, eans);
    return this.get(em, id);
  }

  public async update(
    em: EntityManager,
    id: string,
    dto: UpsertClusterDto,
  ): Promise<ClusterApi & { eans: string[] }> {
    await this.get(em, id); // 404 se não existir
    await em.query(
      `UPDATE product_cluster SET name = $1, updated_at = now() WHERE id = $2`,
      [dto.name.trim(), id],
    );
    // `eans` ausente = só renomeia; presente = substitui a membership.
    if (dto.eans !== undefined) {
      await this.replaceMembers(em, id, this.normalizeEans(dto.eans));
    }
    return this.get(em, id);
  }

  public async remove(
    em: EntityManager,
    id: string,
  ): Promise<{ id: string; name: string }> {
    const usedBy: Array<{ name: string }> = await em.query(
      `SELECT name FROM pricing_suggestion_rule
        WHERE deleted_at IS NULL
          AND (cluster_id = $1 OR exclude_cluster_ids @> $2::jsonb)`,
      [id, JSON.stringify([id])],
    );
    if (usedBy.length) {
      const names = [...new Set(usedBy.map((r) => r.name))].join(', ');
      throw new ConflictException(
        `Cluster em uso pela(s) regra(s): ${names}. Remova a regra antes.`,
      );
    }
    const deleted: Array<{ id: string; name: string }> = await em.query(
      `UPDATE product_cluster SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, name`,
      [id],
    );
    if (!deleted.length) throw new NotFoundException(`cluster ${id} not found`);
    return deleted[0];
  }

  /**
   * Membership dos clusters referenciados por regra ATIVA → Map<ean, clusterId[]>.
   * Carregada uma vez por geração de sugestão (nunca por produto).
   */
  public async loadActiveClusterMembership(
    em: EntityManager,
  ): Promise<Map<string, string[]>> {
    const rows: Array<{ ean: string; clusterId: string }> = await em.query(
      `SELECT m.ean, m.cluster_id AS "clusterId"
         FROM product_cluster_member m
        WHERE m.cluster_id IN (
          SELECT cluster_id FROM pricing_suggestion_rule
            WHERE active = true AND deleted_at IS NULL AND cluster_id IS NOT NULL
          UNION
          SELECT jsonb_array_elements_text(exclude_cluster_ids)::uuid
            FROM pricing_suggestion_rule
            WHERE active = true AND deleted_at IS NULL
        )`,
    );
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.ean);
      if (list) list.push(r.clusterId);
      else map.set(r.ean, [r.clusterId]);
    }
    return map;
  }

  private async replaceMembers(
    em: EntityManager,
    clusterId: string,
    eans: string[],
  ): Promise<void> {
    await em.query(`DELETE FROM product_cluster_member WHERE cluster_id = $1`, [
      clusterId,
    ]);
    if (!eans.length) return;
    const values = eans.map((_, i) => `($1, $${i + 2})`).join(', ');
    await em.query(
      `INSERT INTO product_cluster_member (cluster_id, ean) VALUES ${values}`,
      [clusterId, ...eans],
    );
  }

  private normalizeEans(raw: string[] | undefined): string[] {
    const eans = [...new Set((raw ?? []).map((e) => String(e).trim()))].filter(
      (e) => EAN_RE.test(e),
    );
    if (eans.length > MAX_MEMBERS) {
      throw new BadRequestException(
        `Máximo de ${MAX_MEMBERS} EANs por cluster.`,
      );
    }
    return eans;
  }
}
