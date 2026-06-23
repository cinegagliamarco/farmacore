import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';

export interface CompetitorOriginView {
  origin: CompetitorOrigin;
  priority: number;
  enabled: boolean;
}

/**
 * Origens de concorrente CONFIGURADAS para o tenant (`core.tenant_competitor_origin`,
 * keyed por tenant_id, fora do search_path). Alimenta o seletor de concorrentes da
 * UI e a validação da regra — só faz sentido seguir quem o tenant tem habilitado.
 */
@Injectable()
export class CompetitorOriginsService {
  public async list(
    em: EntityManager,
    slug: string,
  ): Promise<CompetitorOriginView[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{
      origin: CompetitorOrigin;
      priority: string | number;
      enabled: boolean;
    }> = await em.query(
      `SELECT origin, priority, enabled
         FROM core.tenant_competitor_origin
        WHERE tenant_id = $1
        ORDER BY priority ASC, origin ASC`,
      [tenantId],
    );
    return rows
      .filter((r) => Object.values(CompetitorOrigin).includes(r.origin))
      .map((r) => ({
        origin: r.origin,
        priority: Number(r.priority),
        enabled: r.enabled,
      }));
  }

  /** Conjunto das origens HABILITADAS do tenant — usado para validar a regra. */
  public async enabledSet(
    em: EntityManager,
    slug: string,
  ): Promise<Set<CompetitorOrigin>> {
    const list = await this.list(em, slug);
    return new Set(list.filter((o) => o.enabled).map((o) => o.origin));
  }
}
