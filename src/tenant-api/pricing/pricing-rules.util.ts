import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import type { SuggestionRuleApi } from './suggestion-rules.service';

/** Prioridade de cada origem do tenant (core, keyed by tenant_id). Menor = antes. */
export async function originPriorities(
  em: EntityManager,
  slug: string,
): Promise<Map<CompetitorOrigin, number>> {
  const tenantId = await resolveTenantId(em, slug);
  const rows: Array<{ origin: CompetitorOrigin; priority: number }> =
    await em.query(
      `SELECT origin, priority FROM core.tenant_competitor_origin WHERE tenant_id = $1`,
      [tenantId],
    );
  return new Map(rows.map((r) => [r.origin, Number(r.priority)]));
}

/**
 * A regra participa da loja? Com loja: sem escopo (`storeIds` vazio) ou que a
 * lista. Sem loja (visão base / aplicação global): SÓ regra sem escopo — regra
 * escopada nunca precifica nem valida o piso do fluxo global. Usado pela
 * sugestão (ruleContext) e pelo apply (revalidate); manter um único predicado
 * evita drift entre o que precifica e o que valida.
 */
export function ruleParticipates(
  rule: Pick<SuggestionRuleApi, 'storeIds'>,
  storeId: string | null,
): boolean {
  if (rule.storeIds.length === 0) return true;
  return storeId !== null && rule.storeIds.includes(storeId);
}

/**
 * Regras cascade com `cascadeByPriority` têm os competitors reordenados pela
 * priority da origem (§17.6); as demais ficam na ordem do array. Sem o flag,
 * a cascata segue a ordem definida pelo operador (comportamento default).
 */
export function applyCascadePriority(
  rules: SuggestionRuleApi[],
  priorityByOrigin: Map<CompetitorOrigin, number>,
): SuggestionRuleApi[] {
  return rules.map((r) => {
    if (r.competitorMode !== 'cascade' || !r.cascadeByPriority) return r;
    const competitors = [...r.competitors].sort(
      (a, b) =>
        (priorityByOrigin.get(a.competitor) ?? Number.MAX_SAFE_INTEGER) -
        (priorityByOrigin.get(b.competitor) ?? Number.MAX_SAFE_INTEGER),
    );
    return { ...r, competitors };
  });
}
