import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager, IsNull } from 'typeorm';
import { OfferBookRuleEntity } from '../../database/entities/tenant/offer-book-rule.entity';
import { OfferBookRuleExecutionReportEntity } from '../../database/entities/tenant/offer-book-rule-execution-report.entity';
import {
  ItemApplyStatus,
  OfferBookRuleExecutionReportItemEntity,
} from '../../database/entities/tenant/offer-book-rule-execution-report-item.entity';
import { OfferBookRuleProductEntity } from '../../database/entities/tenant/offer-book-rule-product.entity';
import { TenantOfferCampaignEntity } from '../../database/entities/tenant/tenant-offer-campaign.entity';
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

/** RUNNING mais velho que isto pode ser reenfileirado para retomar o mesmo ledger. */
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
  /** Null enquanto a execução assíncrona ainda está em andamento. */
  outcome: ExecutionOutcome | null;
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
 * pelos items `pending`; `erp_applied` dirige somente a reconciliação local.
 * Redelivery nunca recomputa os valores congelados.
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
    // O row-lock serializa POSTs concorrentes. O owner identifica exatamente
    // qual report pode tocar/finalizar a regra.
    const claimRows: Array<{
      status: OfferBookRuleStatus;
      previousReportId: string | null;
      claimable: boolean;
    }> = await em.query(
      `SELECT status,
              active_execution_report_id AS "previousReportId",
              (status <> $2 OR
               updated_at < now() - ($3::int * interval '1 minute')) AS claimable
         FROM offer_book_rule
        WHERE id = $1 AND deleted_at IS NULL
        FOR UPDATE`,
      [ruleId, OfferBookRuleStatus.RUNNING, EXECUTE_LOCK_MINUTES],
    );
    if (claimRows.length === 0)
      throw new NotFoundException(`Regra ${ruleId} não encontrada`);
    if (!claimRows[0].claimable)
      throw new ConflictException(`Regra ${ruleId} já está em execução`);

    const previousReportId = claimRows[0].previousReportId;
    if (claimRows[0].status === OfferBookRuleStatus.RUNNING) {
      if (!previousReportId)
        throw new ConflictException(
          `Regra ${ruleId} possui uma execução inconsistente`,
        );

      // Uma execução velha é retomada com o MESMO report/ledger. Expirar
      // `erp_applied` ou recomputar um report novo poderia perder o mirror de
      // um preço que a A7 já aceitou. O advisory lock prova que não existe um
      // worker vivo antes de reenfileirar a mensagem congelada.
      const lockRows: Array<{ locked: boolean }> = await em.query(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
        [`offer-book-rule:${previousReportId}`],
      );
      if (!lockRows[0]?.locked)
        throw new ConflictException(`Regra ${ruleId} já está em execução`);

      await em.query(
        `UPDATE offer_book_rule SET updated_at = now() WHERE id = $1`,
        [ruleId],
      );
      await this.enqueueExecution(em, slug, previousReportId);
      return { reportId: previousReportId };
    }

    // Vigência é guard somente de uma NOVA execução. Retomar um ledger
    // existente precisa sempre poder concluir `erp_applied` e o mirror local,
    // mesmo se a campanha expirou depois do POST original.
    await this.assertCampaignIsExecutable(em, rule.offerBookInfoId);
    rule.products = await em
      .getRepository(OfferBookRuleProductEntity)
      .find({ where: { ruleId }, select: { ean: true } });

    const reportId = randomUUID();
    await em.query(
      `UPDATE offer_book_rule
          SET status = $2, active_execution_report_id = $3, updated_at = now()
        WHERE id = $1`,
      [ruleId, OfferBookRuleStatus.RUNNING, reportId],
    );

    const results = await this.rules.computeForRule(em, slug, rule);
    const toUpdate = results.filter(shouldPush);
    const skipped = results.filter((r) => !shouldPush(r));

    const reportRepo = em.getRepository(OfferBookRuleExecutionReportEntity);
    const report = await reportRepo.save(
      reportRepo.create({
        id: reportId,
        ruleId,
        offerBookInfoId: rule.offerBookInfoId,
        executedAt: new Date(),
        executionType,
        calculationBaseType: rule.calculationBaseType,
        totalProducts: results.length,
        productsUpdated: 0,
        productsSkipped: skipped.length,
        outcome: null,
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
    await this.enqueueExecution(em, slug, report.id);

    return { reportId: report.id };
  }

  private async enqueueExecution(
    em: EntityManager,
    slug: string,
    reportId: string,
  ): Promise<void> {
    await this.outbox.insertMany(em, reportId, slug, [
      newPipelineMessage({
        pipelineRunId: reportId,
        tenantId: slug,
        step: PipelineStep.EXECUTE_OFFER_BOOK_RULE,
        payload: {},
        standalone: true,
      }),
    ]);
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
      if (query.startDate) {
        if (isDateOnly(query.startDate))
          qb.andWhere(
            `r.executed_at >=
             (CAST(:start AS date)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
            { start: query.startDate },
          );
        else qb.andWhere('r.executed_at >= :start', { start: query.startDate });
      }
      if (query.endDate) {
        if (isDateOnly(query.endDate))
          qb.andWhere(
            `r.executed_at <
             ((CAST(:end AS date) + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
            { end: query.endDate },
          );
        else qb.andWhere('r.executed_at <= :end', { end: query.endDate });
      }
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

  /** Regra persistida pode sobreviver à vigência do caderno; não escrevemos
   * preços em campanha inativa, futura ou expirada. */
  private async assertCampaignIsExecutable(
    em: EntityManager,
    offerBookInfoId: string,
  ): Promise<void> {
    const now = new Date();
    const campaign = await em
      .getRepository(TenantOfferCampaignEntity)
      .createQueryBuilder('c')
      .select('c.id')
      .where('c.externalId = :offerBookInfoId', { offerBookInfoId })
      .andWhere('c.active = true')
      .andWhere('c.deletedAt IS NULL')
      .andWhere('(c.startDate IS NULL OR c.startDate <= :now)', { now })
      .andWhere('(c.expirationDate IS NULL OR c.expirationDate >= :now)', {
        now,
      })
      .getOne();
    if (!campaign)
      throw new ConflictException(
        `Caderno de ofertas ${offerBookInfoId} não está ativo e vigente`,
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
    externalId: r.externalId,
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
    outcome: r.outcome ?? null,
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

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
