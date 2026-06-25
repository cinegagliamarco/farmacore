import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  ALL_COMPETITOR_ORIGINS,
  isKnownOrigin,
  originLabel,
} from '../../database/competitor-origin.registry';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';

export interface CompetitorOriginConfig {
  origin: string;
  label: string;
  priority: number;
  enabled: boolean;
}

@Injectable()
export class CompetitorOriginsService {
  /** All known origins merged with tenant config (priority ASC, origin ASC). */
  public async list(
    em: EntityManager,
    slug: string,
  ): Promise<CompetitorOriginConfig[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{
      origin: string;
      enabled: boolean;
      priority: number;
    }> = await em.query(
      `SELECT origin, enabled, priority
         FROM core.tenant_competitor_origin
        WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    const byOrigin = new Map(rows.map((r) => [r.origin, r]));
    return ALL_COMPETITOR_ORIGINS.map((origin) => {
      const row = byOrigin.get(origin);
      return {
        origin,
        label: originLabel(origin),
        enabled: row?.enabled ?? false,
        priority: Number(row?.priority ?? 100),
      };
    }).sort((a, b) => a.priority - b.priority || a.origin.localeCompare(b.origin));
  }

  /** Enabled origins for the tenant, ordered by priority ASC then origin ASC. */
  public async enabledOrigins(
    em: EntityManager,
    slug: string,
  ): Promise<CompetitorOrigin[]> {
    const configs = await this.list(em, slug);
    return configs
      .filter((c) => c.enabled)
      .map((c) => c.origin)
      .filter(isKnownOrigin);
  }
}
