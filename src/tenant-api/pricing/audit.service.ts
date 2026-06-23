import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export interface AuditEntry {
  actor: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes?: unknown;
}

export interface AuditView {
  actor: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  changes: unknown;
  createdAt: string;
}

/**
 * Trilha de auditoria do tenant (append-only, schema do tenant). Gravada na
 * mesma transação do request — se a mutação rolar, a auditoria rola junto.
 */
@Injectable()
export class AuditService {
  public async log(em: EntityManager, entry: AuditEntry): Promise<void> {
    await em.query(
      `INSERT INTO audit_log (actor, action, entity, entity_id, changes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        entry.actor,
        entry.action,
        entry.entity,
        entry.entityId,
        entry.changes === undefined ? null : JSON.stringify(entry.changes),
      ],
    );
  }

  public async list(
    em: EntityManager,
    filter: { entity?: string; entityId?: string },
    page = 1,
    perPage = 50,
  ): Promise<AuditView[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.entity) {
      params.push(filter.entity);
      where.push(`entity = $${params.length}`);
    }
    if (filter.entityId) {
      params.push(filter.entityId);
      where.push(`entity_id = $${params.length}`);
    }
    const limit = Math.min(Math.max(perPage, 1), 200);
    const offset = (Math.max(page, 1) - 1) * limit;
    params.push(limit, offset);
    return em.query(
      `SELECT actor, action, entity, entity_id AS "entityId", changes,
              created_at AS "createdAt"
         FROM audit_log
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  }
}
