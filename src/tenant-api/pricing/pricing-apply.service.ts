import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { OutboxRepository } from '../../queue/outbox.repository';
import { dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import {
  findClusterRuleForProduct,
  findRuleForProduct,
  priceForMargin,
  resolveWinner,
  type SuggestionProduct,
} from './pricing-suggestion.engine';
import { ClustersService } from './clusters.service';
import { SuggestionRulesService } from './suggestion-rules.service';
import { ApplyItemDto, ApplyPricesDto } from './dto/apply.dto';

export interface ApplyRejection {
  ean: string;
  reason: string;
}

export interface ApplyResponse {
  applyRunId: string;
  accepted: number;
  rejected: ApplyRejection[];
  idempotent?: boolean;
}

export interface ApplyReport {
  id: string;
  status: string;
  mode: string;
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  items: Record<string, unknown>[];
}

interface ProductRow {
  ean: string;
  cost: string | null;
  precoVenda: string | null;
  precoOferta: string | null;
  classificacao: string | null;
  cadernoId: string | null;
}

interface AcceptedItem {
  ean: string;
  target: ApplyItemDto['target'];
  price: number;
  cadernoId: number | null;
  priceOldSell: number | null;
  priceOldOffer: number | null;
  ruleId: string | null;
  costAtApply: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 1000;

/**
 * Aplicação de preço em massa (Fase 3, mode=agora). Revalida cada item
 * (CONGELA o preço aprovado e o valida contra guarda-corpos — nunca recalcula e
 * aplica diferente), cria o run + itens no schema do tenant, e ENFILEIRA o
 * dispatch APPLY_PRICE via outbox (publicado após o commit da request). O push
 * ao ERP roda no worker (apply-price.batch.consumer → CatalogMutationService).
 */
@Injectable()
export class PricingApplyService {
  constructor(
    private readonly rules: SuggestionRulesService,
    private readonly clusters: ClustersService,
    private readonly outbox: OutboxRepository,
  ) {}

  public async apply(
    em: EntityManager,
    slug: string,
    requestedBy: string,
    dto: ApplyPricesDto,
  ): Promise<ApplyResponse> {
    const existing: Array<{ id: string; total: number }> = await em.query(
      `SELECT id, total FROM pricing_apply_run
        WHERE idempotency_key = $1 AND deleted_at IS NULL LIMIT 1`,
      [dto.idempotencyKey],
    );
    if (existing.length) {
      return {
        applyRunId: existing[0].id,
        accepted: Number(existing[0].total),
        rejected: [],
        idempotent: true,
      };
    }

    const { accepted, rejected } = await this.revalidate(em, dto.items);
    const applyRunId = randomUUID();
    await em.query(
      `INSERT INTO pricing_apply_run
         (id, idempotency_key, mode, requested_by, status, total)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [
        applyRunId,
        dto.idempotencyKey,
        dto.mode ?? 'agora',
        requestedBy,
        accepted.length,
      ],
    );
    for (const a of accepted) {
      await em.query(
        `INSERT INTO pricing_apply_item
           (apply_run_id, ean, target, price, caderno_id, price_old_sell,
            price_old_offer, rule_id, cost_at_apply, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
        [
          applyRunId,
          a.ean,
          a.target,
          a.price,
          a.cadernoId,
          a.priceOldSell,
          a.priceOldOffer,
          a.ruleId,
          a.costAtApply,
        ],
      );
    }

    if (accepted.length > 0) {
      // Outbox = publica o dispatch só APÓS o commit da request (senão o
      // consumer correria o commit e não acharia o run).
      await this.outbox.insertMany(em, applyRunId, slug, [
        newPipelineMessage({
          pipelineRunId: applyRunId,
          tenantId: slug,
          step: PipelineStep.APPLY_PRICE,
          queue: dispatchStep(PipelineStep.APPLY_PRICE),
          payload: {},
          standalone: true,
        }),
      ]);
    } else {
      await em.query(
        `UPDATE pricing_apply_run SET status='done', updated_at=now() WHERE id=$1`,
        [applyRunId],
      );
    }

    return { applyRunId, accepted: accepted.length, rejected };
  }

  public async report(
    em: EntityManager,
    id: string,
    page = 1,
    perPage = DEFAULT_PER_PAGE,
  ): Promise<ApplyReport> {
    const runs: Array<{
      id: string;
      status: string;
      mode: string;
      total: number;
      applied: number;
      skipped: number;
      failed: number;
    }> = await em.query(
      `SELECT id, status, mode, total, applied, skipped, failed
         FROM pricing_apply_run WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id],
    );
    if (!runs.length) throw new NotFoundException(`apply run ${id} not found`);
    const limit = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
    const offset = (Math.max(page, 1) - 1) * limit;
    const items: Record<string, unknown>[] = await em.query(
      `SELECT ean, target, price, status, reason,
              price_old_sell AS "priceOld", caderno_id AS "cadernoId",
              rule_id AS "ruleId", erp_result AS "erpResult",
              applied_at AS "appliedAt"
         FROM pricing_apply_item
        WHERE apply_run_id = $1
        ORDER BY ean
        LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    return { ...runs[0], items };
  }

  /**
   * Congela o preço aprovado e valida contra guarda-corpos reusando o motor:
   * piso de margem da regra vencedora (ou custo, se não há regra) e, para
   * oferta, preço ≤ venda + caderno resolvível. NÃO recalcula nem substitui o
   * preço — só aceita ou rejeita. monitored/sem_external_id/sem_credencial são
   * checados no apply (worker), virando reason no relatório.
   */
  private async revalidate(
    em: EntityManager,
    items: ApplyItemDto[],
  ): Promise<{ accepted: AcceptedItem[]; rejected: ApplyRejection[] }> {
    const eans = [...new Set(items.map((i) => i.ean))];
    const rows: ProductRow[] = await em.query(
      `SELECT p.ean::text AS ean, p.cost, p.price AS "precoVenda",
              ob.target_price AS "precoOferta", c.name AS classificacao,
              ob.external_id::text AS "cadernoId"
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
        WHERE p.ean = ANY($1::bigint[])`,
      [eans],
    );
    const byEan = new Map(rows.map((r) => [r.ean, r]));

    const active = (await this.rules.list(em)).filter((r) => r.active);
    const clusterRules = active.filter((r) => r.clusterId);
    const classRules = active.filter((r) => !r.clusterId);
    const usesClusters = active.some(
      (r) => r.clusterId || r.excludeClusterIds.length > 0,
    );
    const membership = usesClusters
      ? await this.clusters.loadActiveClusterMembership(em)
      : new Map<string, string[]>();

    const accepted: AcceptedItem[] = [];
    const rejected: ApplyRejection[] = [];
    for (const item of items) {
      const row = byEan.get(item.ean);
      if (!row) {
        rejected.push({ ean: item.ean, reason: 'nao_encontrado' });
        continue;
      }
      const cost = num(row.cost) ?? 0;
      const precoVenda = num(row.precoVenda) ?? 0;
      const clusterIds = membership.get(item.ean) ?? [];
      const winner = resolveWinner(
        clusterIds.length
          ? findClusterRuleForProduct(clusterRules, clusterIds)
          : null,
        findRuleForProduct(
          { classificacao: row.classificacao ?? '' } as SuggestionProduct,
          classRules,
          clusterIds,
        ),
      ).winner;
      const floor = winner
        ? priceForMargin(cost, Number(winner.minMargin))
        : cost;

      if (item.price + 0.005 < floor) {
        rejected.push({ ean: item.ean, reason: 'abaixo_do_piso' });
        continue;
      }
      let cadernoId: number | null = null;
      if (item.target === 'precoOferta') {
        if (precoVenda > 0 && item.price > precoVenda + 0.005) {
          rejected.push({ ean: item.ean, reason: 'acima_do_venda' });
          continue;
        }
        cadernoId = item.cadernoId ?? num(row.cadernoId);
        if (cadernoId == null) {
          rejected.push({ ean: item.ean, reason: 'sem_caderno' });
          continue;
        }
      }
      accepted.push({
        ean: item.ean,
        target: item.target,
        price: item.price,
        cadernoId,
        priceOldSell: precoVenda || null,
        priceOldOffer: num(row.precoOferta),
        ruleId: winner?.id ?? null,
        costAtApply: cost || null,
      });
    }
    return { accepted, rejected };
  }
}
