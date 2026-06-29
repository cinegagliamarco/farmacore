import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { PricingApplyItemEntity } from '../../database/entities/tenant/pricing-apply-item.entity';
import { PricingApplyRunEntity } from '../../database/entities/tenant/pricing-apply-run.entity';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { OutboxRepository } from '../../queue/outbox.repository';
import { dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import {
  computeSuggestion,
  findClusterRuleForProduct,
  findRuleForProduct,
  priceForMargin,
  resolveWinner,
  type SuggestionProduct,
} from './pricing-suggestion.engine';
import {
  buildClassificationIndex,
  type ClassificationIndex,
} from '../classification/classification-index';
import { ClassificationsService } from '../config/classifications.service';
import { ClustersService } from './clusters.service';
import { applyCascadePriority, originPriorities } from './pricing-rules.util';
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
  // 'pending' quando o run aguarda aprovação (não despachado ainda).
  approvalStatus?: 'pending';
}

export interface ApplyReport {
  id: string;
  status: string;
  mode: string;
  approvalStatus: string | null;
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  items: Record<string, unknown>[];
}

export interface ApplyRunSummary {
  id: string;
  status: string;
  mode: string;
  approvalStatus: string | null;
  total: number;
  applied: number;
  skipped: number;
  failed: number;
  createdAt: string;
}

export interface ApplyPreview {
  total: number;
  accepted: {
    ean: string;
    target: string;
    price: number;
    basis: string | null;
  }[];
  rejected: ApplyRejection[];
  wouldAbort: boolean;
}

interface ProductRow {
  ean: string;
  cost: string | null;
  precoVenda: string | null;
  precoOferta: string | null;
  classificationId: string | null;
  classificacao: string | null;
  cadernoId: string | null;
  competitorPrices: Partial<Record<CompetitorOrigin, number>>;
  pbm: boolean;
}

interface AcceptedItem {
  ean: string;
  target: ApplyItemDto['target'];
  price: number;
  cadernoId: number | null;
  priceOldSell: number | null;
  priceOldOffer: number | null;
  ruleId: string | null;
  basis: string | null;
  costAtApply: number | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const DEFAULT_PER_PAGE = 100;
const MAX_PER_PAGE = 1000;
// Tolerância de meio-centavo (mesma do motor) para comparações de preço.
const PRICE_EPSILON = 0.005;
// Teto de variação (fat-finger / bug): rejeita preço que sobe >3x ou cai a <1/3
// do preço atual do alvo. Salvaguarda — não trava repricing legítimo. Tunável.
const VARIATION_CEILING = 3;
// Circuit breaker: em lote grande (≥10) com >50% rejeitado, aborta o run inteiro
// (provável regra/bug ruim) em vez de aplicar a fração "válida". Tunável.
const CIRCUIT_MIN_ITEMS = 10;
const CIRCUIT_MAX_REJECT_RATE = 0.5;

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
    private readonly classifications: ClassificationsService,
  ) {}

  public async apply(
    em: EntityManager,
    slug: string,
    requestedBy: string | null,
    dto: ApplyPricesDto,
    opts: { requireApproval?: boolean } = {},
  ): Promise<ApplyResponse> {
    const existing = await this.findByIdempotencyKey(em, dto.idempotencyKey);
    if (existing) return existing;

    const { accepted, rejected } = await this.revalidate(em, slug, dto.items);
    // Circuit breaker: lote grande majoritariamente rejeitado → não aplica nada
    // (provável regra/bug que mis-precificaria a base). Devolve 422 + detalhe.
    const total = accepted.length + rejected.length;
    if (
      total >= CIRCUIT_MIN_ITEMS &&
      rejected.length / total > CIRCUIT_MAX_REJECT_RATE
    ) {
      throw new HttpException(
        {
          message: `Lote abortado: ${rejected.length}/${total} itens rejeitados. Revise as regras/preços.`,
          aborted: true,
          rejected,
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const applyRunId = randomUUID();
    // ON CONFLICT em vez de read-then-insert: dois POSTs simultâneos com a mesma
    // key não viram 500 — o perdedor recebe o run existente (idempotente).
    const inserted: Array<{ id: string }> = await em.query(
      `INSERT INTO pricing_apply_run
         (id, idempotency_key, mode, requested_by, status, total)
       VALUES ($1, $2, $3, $4, 'pending', $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        applyRunId,
        dto.idempotencyKey,
        dto.mode ?? 'agora',
        requestedBy,
        accepted.length,
      ],
    );
    if (!inserted.length) {
      return (await this.findByIdempotencyKey(em, dto.idempotencyKey))!;
    }

    await this.insertItems(em, applyRunId, accepted);

    if (accepted.length === 0) {
      await em
        .getRepository(PricingApplyRunEntity)
        .update({ id: applyRunId }, { status: 'done' });
      return { applyRunId, accepted: 0, rejected };
    }
    if (opts.requireApproval) {
      // Segura o dispatch: o run fica 'pending' até um admin aprovar.
      await em
        .getRepository(PricingApplyRunEntity)
        .update({ id: applyRunId }, { approvalStatus: 'pending' });
      return {
        applyRunId,
        accepted: accepted.length,
        rejected,
        approvalStatus: 'pending',
      };
    }
    await this.enqueueDispatch(em, slug, applyRunId);
    return { applyRunId, accepted: accepted.length, rejected };
  }

  /**
   * Aprova um run que aguardava aprovação e despacha ao ERP. Idempotente no
   * sentido de estado: só transita de 'pending' → 'approved' (UPDATE filtra o
   * status atual via repositório → `.affected`, evitando o [rows,count]).
   */
  public async approve(
    em: EntityManager,
    slug: string,
    runId: string,
  ): Promise<{ id: string; approved: boolean }> {
    const res = await em
      .getRepository(PricingApplyRunEntity)
      .update(
        { id: runId, approvalStatus: 'pending' },
        { approvalStatus: 'approved' },
      );
    if (!res.affected) throw await this.approvalConflict(em, runId);
    await this.enqueueDispatch(em, slug, runId);
    return { id: runId, approved: true };
  }

  /** Rejeita um run pendente: marca o run e os itens como failed (não despacha). */
  public async reject(
    em: EntityManager,
    runId: string,
  ): Promise<{ id: string; rejected: boolean }> {
    const res = await em
      .getRepository(PricingApplyRunEntity)
      .update(
        { id: runId, approvalStatus: 'pending' },
        { approvalStatus: 'rejected', status: 'failed' },
      );
    if (!res.affected) throw await this.approvalConflict(em, runId);
    await em
      .getRepository(PricingApplyRunEntity)
      .createQueryBuilder()
      .update()
      .set({ failed: () => 'total' })
      .where('id = :id', { id: runId })
      .execute();
    await em.getRepository(PricingApplyItemEntity).update(
      { applyRunId: runId, status: 'pending' },
      { status: 'failed', reason: 'rejeitado' },
    );
    return { id: runId, rejected: true };
  }

  private async approvalConflict(
    em: EntityManager,
    runId: string,
  ): Promise<HttpException> {
    const run = await em
      .getRepository(PricingApplyRunEntity)
      .findOne({ where: { id: runId } });
    if (!run) return new NotFoundException(`apply run ${runId} not found`);
    return new ConflictException(
      `apply run ${runId} não está aguardando aprovação (${run.approvalStatus ?? 'sem aprovação'}).`,
    );
  }

  /**
   * Outbox = publica o dispatch só APÓS o commit da request (senão o consumer
   * correria o commit e não acharia o run). Sem `standalone`: é o successors()
   * do último batch que fecha o run em `done` — standalone o suprimiria e o run
   * ficaria preso em `running`.
   */
  private async enqueueDispatch(
    em: EntityManager,
    slug: string,
    applyRunId: string,
  ): Promise<void> {
    await this.outbox.insertMany(em, applyRunId, slug, [
      newPipelineMessage({
        pipelineRunId: applyRunId,
        tenantId: slug,
        step: PipelineStep.APPLY_PRICE,
        queue: dispatchStep(PipelineStep.APPLY_PRICE),
        payload: {},
      }),
    ]);
  }

  private async findByIdempotencyKey(
    em: EntityManager,
    key: string,
  ): Promise<ApplyResponse | null> {
    const run = await em
      .getRepository(PricingApplyRunEntity)
      .findOne({ where: { idempotencyKey: key } });
    if (!run) return null;
    return {
      applyRunId: run.id,
      accepted: run.total,
      rejected: [],
      idempotent: true,
    };
  }

  /** Insere os itens em lotes multi-row (até 5000 itens → poucos round-trips). */
  private async insertItems(
    em: EntityManager,
    applyRunId: string,
    accepted: AcceptedItem[],
  ): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < accepted.length; i += CHUNK) {
      const slice = accepted.slice(i, i + CHUNK);
      const params: unknown[] = [applyRunId];
      const values = slice
        .map((a, j) => {
          const b = 1 + j * 9;
          params.push(
            a.ean,
            a.target,
            a.price,
            a.cadernoId,
            a.priceOldSell,
            a.priceOldOffer,
            a.ruleId,
            a.basis,
            a.costAtApply,
          );
          return `($1,$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
        })
        .join(',');
      await em.query(
        `INSERT INTO pricing_apply_item
           (apply_run_id, ean, target, price, caderno_id, price_old_sell,
            price_old_offer, rule_id, basis, cost_at_apply)
         VALUES ${values}`,
        params,
      );
    }
  }

  public async report(
    em: EntityManager,
    id: string,
    page = 1,
    perPage = DEFAULT_PER_PAGE,
  ): Promise<ApplyReport> {
    const run = await em.getRepository(PricingApplyRunEntity).findOne({
      where: { id },
    });
    if (!run) throw new NotFoundException(`apply run ${id} not found`);
    const limit = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
    const offset = (Math.max(page, 1) - 1) * limit;
    const rows = await em.getRepository(PricingApplyItemEntity).find({
      where: { applyRunId: id },
      order: { ean: 'ASC' },
      take: limit,
      skip: offset,
    });
    const items: Record<string, unknown>[] = rows.map((item) => ({
      ean: item.ean,
      target: item.target,
      price: item.price,
      status: item.status,
      reason: item.reason,
      basis: item.basis,
      priceOld: item.priceOldSell,
      cadernoId: item.cadernoId,
      ruleId: item.ruleId,
      erpResult: item.erpResult,
      appliedAt: item.appliedAt,
    }));
    return {
      id: run.id,
      status: run.status,
      mode: run.mode,
      approvalStatus: run.approvalStatus,
      total: run.total,
      applied: run.applied,
      skipped: run.skipped,
      failed: run.failed,
      items,
    };
  }

  /** Histórico de runs (não-deletados), mais recentes primeiro. */
  public async list(
    em: EntityManager,
    page = 1,
    perPage = DEFAULT_PER_PAGE,
  ): Promise<ApplyRunSummary[]> {
    const limit = Math.min(Math.max(perPage, 1), MAX_PER_PAGE);
    const offset = (Math.max(page, 1) - 1) * limit;
    const runs = await em.getRepository(PricingApplyRunEntity).find({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return runs.map((run) => ({
      id: run.id,
      status: run.status,
      mode: run.mode,
      approvalStatus: run.approvalStatus,
      total: run.total,
      applied: run.applied,
      skipped: run.skipped,
      failed: run.failed,
      createdAt: run.createdAt.toISOString(),
    }));
  }

  /**
   * Dry-run: revalida os itens (mesmas guarda-corpos do apply) e devolve o que
   * SERIA aceito/rejeitado — sem criar run nem enfileirar nada. `wouldAbort`
   * sinaliza que o circuit breaker barraria o lote real.
   */
  public async preview(
    em: EntityManager,
    slug: string,
    items: ApplyItemDto[],
  ): Promise<ApplyPreview> {
    const { accepted, rejected } = await this.revalidate(em, slug, items);
    const total = accepted.length + rejected.length;
    const wouldAbort =
      total >= CIRCUIT_MIN_ITEMS &&
      rejected.length / total > CIRCUIT_MAX_REJECT_RATE;
    return {
      total,
      accepted: accepted.map((a) => ({
        ean: a.ean,
        target: a.target,
        price: a.price,
        basis: a.basis,
      })),
      rejected,
      wouldAbort,
    };
  }

  /**
   * Desfaz um run: reaplica o preço ANTERIOR (price_old do alvo) de cada item
   * que de fato chegou ao ERP (status='applied'). Reusa o apply (passa pelas
   * mesmas guarda-corpos — não restaura preço hoje inválido) com idempotência
   * `rollback:<runId>`, então repetir o POST é seguro.
   */
  public async rollback(
    em: EntityManager,
    slug: string,
    requestedBy: string | null,
    runId: string,
  ): Promise<ApplyResponse> {
    const exists = await em
      .getRepository(PricingApplyRunEntity)
      .findOne({ where: { id: runId } });
    if (!exists)
      throw new NotFoundException(`apply run ${runId} not found`);

    const applied = await em.getRepository(PricingApplyItemEntity).find({
      where: { applyRunId: runId, status: 'applied' },
    });
    const items: ApplyItemDto[] = applied
      .map((item) => {
        const priceOld =
          item.target === 'precoOferta'
            ? item.priceOldOffer
            : item.priceOldSell;
        return {
          ean: item.ean,
          target: item.target,
          price: num(priceOld) ?? 0,
          cadernoId: num(item.cadernoId) ?? undefined,
        };
      })
      .filter((i) => i.price > 0);
    if (!items.length) {
      throw new HttpException(
        { message: `Run ${runId} não tem item aplicado reversível.` },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.apply(em, slug, requestedBy, {
      idempotencyKey: `rollback:${runId}`,
      mode: 'agora',
      items,
    });
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
    slug: string,
    items: ApplyItemDto[],
  ): Promise<{ accepted: AcceptedItem[]; rejected: ApplyRejection[] }> {
    const eans = [...new Set(items.map((i) => i.ean))];
    const origins = await this.enabledOrigins(em, slug);
    const rows = await this.loadEansData(em, origins, eans);
    const byEan = new Map(rows.map((r) => [r.ean, r]));

    let active = (await this.rules.list(em)).filter((r) => r.active);
    if (
      active.some((r) => r.competitorMode === 'cascade' && r.cascadeByPriority)
    ) {
      active = applyCascadePriority(active, await originPriorities(em, slug));
    }
    const clusterRules = active.filter((r) => r.clusterId);
    const classRules = active.filter((r) => !r.clusterId);
    const usesClusters = active.some(
      (r) => r.clusterId || r.excludeClusterIds.length > 0,
    );
    const membership = usesClusters
      ? await this.clusters.loadActiveClusterMembership(em)
      : new Map<string, string[]>();
    const classificationIndex = await this.classificationIndex(em);

    // Dedup por (ean, target): dois itens para o mesmo alvo causariam preço
    // final não-determinístico no ERP (batches correm em ordem indefinida).
    // O último vence (intenção mais recente do operador).
    const deduped = [
      ...new Map(items.map((i) => [`${i.ean}|${i.target}`, i])).values(),
    ];

    const accepted: AcceptedItem[] = [];
    const rejected: ApplyRejection[] = [];
    for (const item of deduped) {
      const row = byEan.get(item.ean);
      if (!row) {
        rejected.push({ ean: item.ean, reason: 'nao_encontrado' });
        continue;
      }
      const cost = num(row.cost) ?? 0;
      const precoVenda = num(row.precoVenda) ?? 0;
      const precoOferta = num(row.precoOferta) ?? 0;
      // Sem custo não há piso de margem confiável (mesma guarda do motor) — sem
      // isto, floor cairia para 0 e um preço ~0 chegaria ao ERP.
      if (cost <= 0) {
        rejected.push({ ean: item.ean, reason: 'sem_custo' });
        continue;
      }
      if (item.price <= 0) {
        rejected.push({ ean: item.ean, reason: 'preco_invalido' });
        continue;
      }
      const clusterIds = membership.get(item.ean) ?? [];
      const sp = this.toSuggestionProduct(row, cost, precoVenda, precoOferta);
      const winner = resolveWinner(
        clusterIds.length
          ? findClusterRuleForProduct(clusterRules, clusterIds)
          : null,
        findRuleForProduct(sp, classRules, clusterIds, classificationIndex),
      ).winner;
      const floor = winner
        ? priceForMargin(cost, Number(winner.minMargin))
        : cost;

      if (item.price + PRICE_EPSILON < floor) {
        rejected.push({ ean: item.ean, reason: 'abaixo_do_piso' });
        continue;
      }
      // Teto de variação vs preço atual do alvo (fat-finger / bug).
      const current = item.target === 'precoOferta' ? precoOferta : precoVenda;
      if (
        current > 0 &&
        (item.price > current * VARIATION_CEILING ||
          item.price * VARIATION_CEILING < current)
      ) {
        rejected.push({ ean: item.ean, reason: 'variacao_excessiva' });
        continue;
      }
      let cadernoId: number | null = null;
      if (item.target === 'precoOferta') {
        if (precoVenda > 0 && item.price > precoVenda + PRICE_EPSILON) {
          rejected.push({ ean: item.ean, reason: 'acima_do_venda' });
          continue;
        }
        cadernoId = item.cadernoId ?? num(row.cadernoId);
        if (cadernoId == null) {
          rejected.push({ ean: item.ean, reason: 'sem_caderno' });
          continue;
        }
      }
      // basis para auditoria: roda o motor (rounding não afeta o basis → []).
      const result = winner ? computeSuggestion(sp, winner, []) : null;
      accepted.push({
        ean: item.ean,
        target: item.target,
        price: item.price,
        cadernoId,
        priceOldSell: precoVenda || null,
        priceOldOffer: precoOferta || null,
        ruleId: winner?.id ?? null,
        basis: result?.kind === 'suggestion' ? result.suggestion.basis : null,
        costAtApply: cost || null,
      });
    }
    return { accepted, rejected };
  }

  private async classificationIndex(
    em: EntityManager,
  ): Promise<ClassificationIndex> {
    const rows = await this.classifications.list(em);
    return buildClassificationIndex(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
      })),
    );
  }

  /** Origens de concorrente habilitadas do tenant (core, fora do search_path). */
  private async enabledOrigins(
    em: EntityManager,
    slug: string,
  ): Promise<CompetitorOrigin[]> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ origin: CompetitorOrigin }> = await em.query(
      `SELECT origin FROM core.tenant_competitor_origin
        WHERE tenant_id = $1 AND enabled = true
        ORDER BY priority ASC, origin ASC`,
      [tenantId],
    );
    return rows
      .map((r) => r.origin)
      .filter((o): o is CompetitorOrigin =>
        Object.values(CompetitorOrigin).includes(o),
      );
  }

  /** Dados dos EANs do apply: produto + caderno + preço/PBM de cada origem
   *  habilitada (join dinâmico, valores do enum — seguro interpolar). */
  private async loadEansData(
    em: EntityManager,
    origins: CompetitorOrigin[],
    eans: string[],
  ): Promise<ProductRow[]> {
    const joins = origins
      .map(
        (o) =>
          `LEFT JOIN shared_catalog.product o_${o} ON o_${o}.ean = p.ean AND o_${o}.origin = '${o}'`,
      )
      .join('\n         ');
    const selects = origins
      .map(
        (o) =>
          `o_${o}.price AS "${o}__price", (o_${o}.metadata->>'isPbm') = 'true' AS "${o}__isPbm"`,
      )
      .join(', ');
    const rows: Array<Record<string, unknown>> = await em.query(
      `SELECT p.ean::text AS ean, p.cost, p.price AS "precoVenda",
              ob.target_price AS "precoOferta", p.classification_id AS "classificationId",
              c.name AS classificacao,
              ob.external_id::text AS "cadernoId"
              ${selects ? ',' + selects : ''}
         FROM product p
         LEFT JOIN classification c ON c.id = p.classification_id
         LEFT JOIN offer_book ob ON ob.ean = p.ean
         ${joins}
        WHERE p.ean = ANY($1::bigint[])`,
      [eans],
    );
    return rows.map((r) => {
      const competitorPrices: Partial<Record<CompetitorOrigin, number>> = {};
      let pbm = false;
      for (const o of origins) {
        const price = num(r[`${o}__price`]);
        if (price && price > 0) competitorPrices[o] = price;
        if (r[`${o}__isPbm`] === true) pbm = true;
      }
      return {
        ean: String(r.ean),
        cost: r.cost as string | null,
        precoVenda: r.precoVenda as string | null,
        precoOferta: r.precoOferta as string | null,
        classificationId: (r.classificationId as string | null) ?? null,
        classificacao: r.classificacao as string | null,
        cadernoId: r.cadernoId as string | null,
        competitorPrices,
        pbm,
      };
    });
  }

  private toSuggestionProduct(
    row: ProductRow,
    custo: number,
    precoVenda: number,
    precoOferta: number,
  ): SuggestionProduct {
    return {
      id: 0,
      ean: row.ean,
      nome: '',
      fabricante: '',
      classificationId: row.classificationId,
      classificacao: row.classificacao ?? '',
      cadernoOferta: '',
      custo,
      precoVenda,
      precoOferta,
      competitorPrices: row.competitorPrices,
      margem: 0,
      pbm: row.pbm,
    };
  }
}
