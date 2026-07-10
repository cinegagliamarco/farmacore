import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { OfferBookRuleEntity } from '../../database/entities/tenant/offer-book-rule.entity';
import { OfferBookRuleExecutionReportEntity } from '../../database/entities/tenant/offer-book-rule-execution-report.entity';
import {
  ItemApplyStatus,
  OfferBookRuleExecutionReportItemEntity,
} from '../../database/entities/tenant/offer-book-rule-execution-report-item.entity';
import { OfferBookRuleProductEntity } from '../../database/entities/tenant/offer-book-rule-product.entity';
import { ExecutionOutcome } from '../../database/enums/execution-outcome.enum';
import { ExecutionType } from '../../database/enums/execution-type.enum';
import { OfferBookRuleStatus } from '../../database/enums/offer-book-rule-status.enum';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { OutboxRepository } from '../../queue/outbox.repository';
import { newPipelineMessage } from '../../queue/types';
import { OfferBookRulesService } from './offer-book-rules.service';
import {
  ListReportsQueryDto,
  PaginationQueryDto,
  ReportItemsQueryDto,
} from './dto/execution-reports-query.dto';
import { PreviewProductResult } from './dto/preview-offer-book-rules.dto';

/** RUNNING mais velho que isto é reclamável (execução morta, lock expirado). */
const EXECUTE_LOCK_MINUTES = 30;
const ITEM_INSERT_CHUNK = 500;

export interface ExecutionReportHeader {
  id: string;
  ruleId: string;
  offerBookInfoId: number;
  executedAt: string;
  executionType: ExecutionType;
  calculationBaseType: string;
  totalProducts: number;
  productsUpdated: number;
  productsSkipped: number;
  outcome: ExecutionOutcome;
  errorMessage: string | null;
}

export interface PaginatedReports {
  rows: ExecutionReportHeader[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ExecutionReportItem {
  ean: string;
  name: string;
  classification: string;
  baseSalePrice: number;
  currentPrice: number;
  currentMargin: number;
  cost: number;
  actionType: string | null;
  percentageValue: number;
  appliedPercentageValue: number;
  finalPrice: number;
  newMargin: number;
  priceLockApplied: boolean;
  discountSkipped: boolean;
  skippedNoCompetitorPrice: boolean;
  skippedPriceExceedsLimit: boolean;
  priceRoundingApplied: boolean;
  wasUpdated: boolean;
  applyStatus: ItemApplyStatus;
  applyError: string | null;
}

export interface ExecutionReportDetail {
  report: ExecutionReportHeader;
  items: ExecutionReportItem[];
  totalItems: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Execução de uma regra de oferta (Fase 3) — o lado da API. O POST /execute
 * roda na transação do request: faz o claim atômico do RUNNING na regra,
 * COMPUTA os preços na hora e os CONGELA como items `pending` do report (o
 * ledger money-safe), e enfileira a mensagem via outbox (publicada após o
 * commit). O push à A7 acontece no worker (ExecuteOfferBookRuleStep), dirigido
 * exclusivamente pelos items `pending` — redelivery não recomputa nem
 * re-empurra o que já foi aplicado.
 */
@Injectable()
export class OfferBookRulesExecutionService {
  constructor(
    private readonly rules: OfferBookRulesService,
    private readonly outbox: OutboxRepository,
  ) {}

  public async execute(
    em: EntityManager,
    slug: string,
    ruleId: string,
    executionType: ExecutionType = ExecutionType.MANUAL,
  ): Promise<{ reportId: string }> {
    const rule = await em.getRepository(OfferBookRuleEntity).findOne({
      where: { id: ruleId, deletedAt: IsNull() },
      relations: { pricingRules: true, priceLocks: true },
    });
    if (!rule) throw new NotFoundException(`Regra ${ruleId} não encontrada`);
    rule.products = await em
      .getRepository(OfferBookRuleProductEntity)
      .find({ where: { ruleId }, select: { ean: true } });

    // Claim atômico: o row-lock serializa POSTs concorrentes; um RUNNING mais
    // velho que o lock é reclamável (execução morta — sem reset no boot).
    const claimed: unknown = await em.query(
      `UPDATE offer_book_rule
          SET status = $2, updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
          AND (status <> $2
               OR updated_at < now() - interval '${EXECUTE_LOCK_MINUTES} minutes')
        RETURNING id`,
      [ruleId, OfferBookRuleStatus.RUNNING],
    );
    if (rowCount(claimed) === 0)
      throw new ConflictException(`Regra ${ruleId} já está em execução`);
    await this.expireOrphanExecution(em, ruleId);

    const results = await this.rules.computeForRule(em, slug, rule);
    const toUpdate = results.filter(shouldPush);
    const skipped = results.filter((r) => !shouldPush(r));

    const reportRepo = em.getRepository(OfferBookRuleExecutionReportEntity);
    const report = await reportRepo.save(
      reportRepo.create({
        ruleId,
        offerBookInfoId: rule.offerBookInfoId,
        executedAt: new Date(),
        executionType,
        calculationBaseType: rule.calculationBaseType,
        totalProducts: results.length,
        productsUpdated: 0,
        productsSkipped: skipped.length,
        outcome: ExecutionOutcome.SUCCESS,
      }),
    );

    const itemRepo = em.getRepository(OfferBookRuleExecutionReportItemEntity);
    const items = [
      ...toUpdate.map((r) => toItem(report.id, r, 'pending' as const)),
      ...skipped.map((r) => toItem(report.id, r, 'skipped' as const)),
    ];
    for (let i = 0; i < items.length; i += ITEM_INSERT_CHUNK)
      await itemRepo.insert(items.slice(i, i + ITEM_INSERT_CHUNK));

    // Publicada só após o commit (outbox) — o worker nunca corre o commit.
    await this.outbox.insertMany(em, report.id, slug, [
      newPipelineMessage({
        pipelineRunId: report.id,
        tenantId: slug,
        step: PipelineStep.EXECUTE_OFFER_BOOK_RULE,
        payload: {},
        standalone: true,
      }),
    ]);

    return { reportId: report.id };
  }

  public async listByRule(
    em: EntityManager,
    ruleId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedReports> {
    return this.pagedReports(em, query, (qb) =>
      qb.andWhere('r.rule_id = :ruleId', { ruleId }),
    );
  }

  public async listAll(
    em: EntityManager,
    query: ListReportsQueryDto,
  ): Promise<PaginatedReports> {
    return this.pagedReports(em, query, (qb) => {
      if (query.ruleId)
        qb.andWhere('r.rule_id = :ruleId', { ruleId: query.ruleId });
      if (query.offerBookInfoId !== undefined)
        qb.andWhere('r.offer_book_info_id = :info', {
          info: String(query.offerBookInfoId),
        });
      if (query.executionType)
        qb.andWhere('r.execution_type = :etype', {
          etype: query.executionType,
        });
      if (query.outcome)
        qb.andWhere('r.outcome = :outcome', { outcome: query.outcome });
      if (query.startDate)
        qb.andWhere('r.executed_at >= :start', { start: query.startDate });
      if (query.endDate)
        qb.andWhere('r.executed_at <= :end', { end: query.endDate });
      return qb;
    });
  }

  public async getReport(
    em: EntityManager,
    reportId: string,
    query: ReportItemsQueryDto,
  ): Promise<ExecutionReportDetail> {
    const report = await em
      .getRepository(OfferBookRuleExecutionReportEntity)
      .findOne({ where: { id: reportId, deletedAt: IsNull() } });
    if (!report)
      throw new NotFoundException(`Relatório ${reportId} não encontrado`);

    const qb = em
      .getRepository(OfferBookRuleExecutionReportItemEntity)
      .createQueryBuilder('i')
      .where('i.report_id = :reportId', { reportId });
    if (query.name)
      qb.andWhere('i.name ILIKE :name', { name: `%${query.name}%` });

    const totalItems = await qb.getCount();
    const items = await qb
      .orderBy('i.ean', 'ASC')
      .skip((query.page - 1) * query.perPage)
      .take(query.perPage)
      .getMany();

    return {
      report: toHeader(report),
      items: items.map(toItemApi),
      totalItems,
      page: query.page,
      pageSize: query.perPage,
      totalPages: Math.ceil(totalItems / query.perPage),
    };
  }

  private async pagedReports(
    em: EntityManager,
    query: PaginationQueryDto,
    refine: (
      qb: import('typeorm').SelectQueryBuilder<OfferBookRuleExecutionReportEntity>,
    ) => unknown,
  ): Promise<PaginatedReports> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.perPage ?? 20, 100);
    const qb = em
      .getRepository(OfferBookRuleExecutionReportEntity)
      .createQueryBuilder('r')
      .where('r.deleted_at IS NULL');
    refine(qb);
    const total = await qb.getCount();
    const rows = await qb
      .orderBy('r.executed_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    return {
      rows: rows.map(toHeader),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Fecha a execução órfã de um claim reclamado: o report anterior com items
   * ainda `pending` (só existe se o run anterior morreu) vira FAILURE e seus
   * pendentes viram `failed`/execucao_expirada — nunca serão empurrados.
   */
  private async expireOrphanExecution(
    em: EntityManager,
    ruleId: string,
  ): Promise<void> {
    await em.query(
      `UPDATE offer_book_rule_execution_report r
          SET outcome = 'FAILURE',
              error_message = 'execução não finalizada (lock expirado)',
              updated_at = now()
        WHERE r.rule_id = $1
          AND EXISTS (SELECT 1 FROM offer_book_rule_execution_report_item i
                       WHERE i.report_id = r.id AND i.apply_status = 'pending')`,
      [ruleId],
    );
    await em.query(
      `UPDATE offer_book_rule_execution_report_item i
          SET apply_status = 'failed', apply_error = 'execucao_expirada',
              updated_at = now()
         FROM offer_book_rule_execution_report r
        WHERE r.id = i.report_id AND r.rule_id = $1
          AND i.apply_status = 'pending'`,
      [ruleId],
    );
  }
}

/** Vai pro ERP: não pulado e com preço efetivamente diferente do atual. */
function shouldPush(r: PreviewProductResult): boolean {
  return (
    !r.skippedNoCompetitorPrice &&
    !r.skippedPriceExceedsLimit &&
    r.finalPrice !== r.currentPrice
  );
}

function toItem(
  reportId: string,
  r: PreviewProductResult,
  applyStatus: ItemApplyStatus,
): Partial<OfferBookRuleExecutionReportItemEntity> {
  return {
    reportId,
    ean: r.ean,
    name: r.name,
    classification: r.classification,
    baseSalePrice: r.baseSalePrice,
    currentPrice: r.currentPrice,
    currentMargin: r.currentMargin,
    cost: r.cost,
    actionType: r.actionType,
    percentageValue: r.percentageValue,
    appliedPercentageValue: r.appliedPercentageValue,
    finalPrice: r.finalPrice,
    newMargin: r.newMargin,
    priceLockApplied: r.priceLockApplied,
    discountSkipped: r.discountSkipped,
    skippedNoCompetitorPrice: r.skippedNoCompetitorPrice,
    skippedPriceExceedsLimit: r.skippedPriceExceedsLimit,
    priceRoundingApplied: r.priceRoundingApplied,
    wasUpdated: false,
    applyStatus,
  };
}

function toHeader(
  r: OfferBookRuleExecutionReportEntity,
): ExecutionReportHeader {
  return {
    id: r.id,
    ruleId: r.ruleId,
    offerBookInfoId: Number(r.offerBookInfoId),
    executedAt: r.executedAt.toISOString(),
    executionType: r.executionType,
    calculationBaseType: r.calculationBaseType,
    totalProducts: r.totalProducts,
    productsUpdated: r.productsUpdated,
    productsSkipped: r.productsSkipped,
    outcome: r.outcome,
    errorMessage: r.errorMessage ?? null,
  };
}

function toItemApi(
  i: OfferBookRuleExecutionReportItemEntity,
): ExecutionReportItem {
  return {
    ean: i.ean,
    name: i.name,
    classification: i.classification,
    baseSalePrice: Number(i.baseSalePrice),
    currentPrice: Number(i.currentPrice),
    currentMargin: Number(i.currentMargin),
    cost: Number(i.cost),
    actionType: i.actionType ?? null,
    percentageValue: Number(i.percentageValue),
    appliedPercentageValue: Number(i.appliedPercentageValue),
    finalPrice: Number(i.finalPrice),
    newMargin: Number(i.newMargin),
    priceLockApplied: i.priceLockApplied,
    discountSkipped: i.discountSkipped,
    skippedNoCompetitorPrice: i.skippedNoCompetitorPrice,
    skippedPriceExceedsLimit: i.skippedPriceExceedsLimit,
    priceRoundingApplied: i.priceRoundingApplied,
    wasUpdated: i.wasUpdated,
    applyStatus: i.applyStatus,
    applyError: i.applyError ?? null,
  };
}

/** pg driver: UPDATE ... RETURNING volta como `[rows, count]` ou só rows. */
function rowCount(raw: unknown): number {
  const arr = raw as unknown[];
  const rows = Array.isArray(arr[0]) ? (arr[0] as unknown[]) : arr;
  return rows.length;
}
