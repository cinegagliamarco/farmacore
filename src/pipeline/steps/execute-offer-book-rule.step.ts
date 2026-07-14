import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OfferBookRuleExecutionReportEntity } from '../../database/entities/tenant/offer-book-rule-execution-report.entity';
import { OfferBookRuleEntity } from '../../database/entities/tenant/offer-book-rule.entity';
import { OfferBookRuleStatus } from '../../database/enums/offer-book-rule-status.enum';
import { OfferBookRepository } from '../../database/repositories/tenant/offer-book.repository';
import { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { DuplicateDeliveryRepublishError } from '../../queue/retry.service';
import { schemaNameFor } from '../../tenant/tenant-schema';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';

/** Itens por POST à A7 (mesmo chunk do legado; o endpoint aceita array). */
const A7_CHUNK = 80;

interface PendingItem {
  id: string;
  ean: string;
  finalPrice: string;
  externalId: string | null;
}

/**
 * Empurra à A7 os preços congelados no report e mantém o espelho local.
 *
 * A transação externa do BasePipelineConsumer segura apenas um advisory lock
 * por report. Cada leitura/escrita do tenant acontece numa transação curta e
 * independente, portanto um erro local nunca desfaz chunks já confirmados.
 * Depois do HTTP bem-sucedido o item passa primeiro por `erp_applied`; se o
 * mirror falhar, a redelivery refaz somente o mirror, sem chamar a A7 de novo.
 */
@Injectable()
export class ExecuteOfferBookRuleStep {
  private readonly logger = new Logger(ExecuteOfferBookRuleStep.name);

  constructor(
    private readonly integration: IntegrationConnectionService,
    private readonly a7: A7PharmaApiClient,
    private readonly tx: TenantTransactionService,
  ) {}

  public async run(
    lockEm: EntityManager,
    tenantSlug: string,
    reportId: string,
  ): Promise<void> {
    // O lease genérico do pipeline expira após 5 minutos. O advisory lock
    // continua válido pela vida real do handler. A tentativa é não bloqueante:
    // duplicatas vão para a DLQ, sem ocupar o pool enquanto o owner precisa de
    // uma segunda conexão para as transações curtas dos chunks.
    const lockRows: Array<{ locked: boolean }> = await lockEm.query(
      `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
      [`offer-book-rule:${reportId}`],
    );
    if (!lockRows[0]?.locked) {
      throw new DuplicateDeliveryRepublishError(
        `report ${reportId} já possui um worker ativo`,
      );
    }

    const schemaName = schemaNameFor(tenantSlug);
    const report = await this.tx.runWithTenant(schemaName, (em) =>
      this.findOwnedReport(em, reportId),
    );
    if (!report) {
      this.logger.warn(`report ${reportId} não é mais executável; ignorando`);
      return;
    }

    // Se a A7 já aceitou um chunk e só o mirror caiu, concluir esse trabalho
    // antes de qualquer novo push. É a fronteira que impede reenvio pós-A7.
    if (!(await this.finishErpApplied(schemaName, report))) return;

    // Uma campanha pode expirar entre o POST e o worker (ou durante uma
    // retomada). O que a A7 já aceitou sempre foi reconciliado acima; novos
    // `pending`, porém, não podem ser enviados a uma campanha inválida.
    if (!(await this.ensureCampaignAllowsPending(schemaName, report))) return;

    const creds = await this.integration.getApiCredentials(tenantSlug);
    if (!creds) {
      await this.tx.runWithTenant(schemaName, async (em) => {
        if (!(await this.touchOwner(em, report))) return;
        await this.markMany(
          em,
          await this.pendingIds(em, report.id),
          'failed',
          'a7_nao_configurado',
        );
        await this.finalizeOwned(em, report);
      });
      return;
    }

    const cadernoId = Number(report.offerBookInfoId);
    for (;;) {
      // Revalida entre chunks longos; se a vigência mudou, fecha somente o
      // trabalho ainda pendente e preserva tudo que já foi aplicado.
      if (!(await this.ensureCampaignAllowsPending(schemaName, report))) return;

      const chunk = await this.tx.runWithTenant(schemaName, async (em) => {
        if (!(await this.touchOwner(em, report))) return null;
        return this.itemsByStatus(em, report.id, 'pending');
      });
      if (chunk === null) {
        this.logger.warn(`report ${report.id} perdeu ownership; interrompendo`);
        return;
      }
      if (chunk.length === 0) break;

      const missing = chunk.filter((item) => !item.externalId);
      if (missing.length) {
        const owned = await this.tx.runWithTenant(schemaName, async (em) => {
          if (!(await this.touchOwner(em, report))) return false;
          await this.markMany(
            em,
            missing.map((item) => item.id),
            'failed',
            'sem_external_id',
          );
          return true;
        });
        if (!owned) return;
      }

      const pushable = chunk.filter((item) => item.externalId);
      if (pushable.length === 0) continue;

      try {
        await this.a7.upsertOffer(
          creds,
          cadernoId,
          pushable.map((item) => ({
            idEmbalagem: Number(item.externalId),
            precoOferta: Number(item.finalPrice),
          })),
        );
      } catch (err) {
        this.logger.error(
          `push A7 falhou (report ${report.id}, ${pushable.length} itens): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        const owned = await this.tx.runWithTenant(schemaName, async (em) => {
          if (!(await this.touchOwner(em, report))) return false;
          await this.markMany(
            em,
            pushable.map((item) => item.id),
            'failed',
            'erro_transitorio',
          );
          return true;
        });
        if (!owned) return;
        continue;
      }

      // Commitir o checkpoint ERP antes do mirror separa o efeito externo da
      // projeção local. Falha do mirror deixa `erp_applied`, nunca `pending`.
      const checkpointed = await this.tx.runWithTenant(
        schemaName,
        async (em) => {
          if (!(await this.touchOwner(em, report))) return false;
          await this.markMany(
            em,
            pushable.map((item) => item.id),
            'erp_applied',
            null,
          );
          return true;
        },
      );
      if (!checkpointed) return;

      await this.mirrorErpAppliedChunk(schemaName, report, pushable, cadernoId);
    }

    await this.tx.runWithTenant(schemaName, async (em) => {
      if (!(await this.touchOwner(em, report))) return;
      await this.finalizeOwned(em, report);
    });
  }

  private async finishErpApplied(
    schemaName: string,
    report: OfferBookRuleExecutionReportEntity,
  ): Promise<boolean> {
    for (;;) {
      const chunk = await this.tx.runWithTenant(schemaName, async (em) => {
        if (!(await this.touchOwner(em, report))) return null;
        return this.itemsByStatus(em, report.id, 'erp_applied');
      });
      if (chunk === null) return false;
      if (chunk.length === 0) return true;
      await this.mirrorErpAppliedChunk(
        schemaName,
        report,
        chunk,
        Number(report.offerBookInfoId),
      );
    }
  }

  private async ensureCampaignAllowsPending(
    schemaName: string,
    report: OfferBookRuleExecutionReportEntity,
  ): Promise<boolean> {
    return this.tx.runWithTenant(schemaName, async (em) => {
      if (!(await this.touchOwner(em, report))) return false;
      const rows: Array<{ valid: boolean }> = await em.query(
        `SELECT EXISTS (
           SELECT 1
             FROM tenant_offer_campaign
            WHERE external_id = $1
              AND active = true
              AND deleted_at IS NULL
              AND (start_date IS NULL OR start_date <= now())
              AND (expiration_date IS NULL OR expiration_date >= now())
         ) AS valid`,
        [report.offerBookInfoId],
      );
      if (rows[0]?.valid) return true;

      await this.markMany(
        em,
        await this.pendingIds(em, report.id),
        'failed',
        'campanha_nao_vigente',
      );
      await this.finalizeOwned(em, report);
      return false;
    });
  }

  private async mirrorErpAppliedChunk(
    schemaName: string,
    report: OfferBookRuleExecutionReportEntity,
    items: PendingItem[],
    cadernoId: number,
  ): Promise<void> {
    try {
      const owned = await this.tx.runWithTenant(schemaName, async (em) => {
        if (!(await this.touchOwner(em, report))) return false;
        await this.mirror(em, items, cadernoId);
        await this.markMany(
          em,
          items.map((item) => item.id),
          'applied',
          null,
        );
        return true;
      });
      if (!owned)
        this.logger.warn(`report ${report.id} perdeu ownership após push A7`);
    } catch (err) {
      this.logger.error(
        `mirror local falhou após sucesso A7 (report ${report.id}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private async findOwnedReport(
    em: EntityManager,
    reportId: string,
  ): Promise<OfferBookRuleExecutionReportEntity | null> {
    const report = await em
      .getRepository(OfferBookRuleExecutionReportEntity)
      .findOne({ where: { id: reportId } });
    if (!report) return null;
    const owned = await em.getRepository(OfferBookRuleEntity).exists({
      where: {
        id: report.ruleId,
        status: OfferBookRuleStatus.RUNNING,
        activeExecutionReportId: report.id,
      },
    });
    return owned ? report : null;
  }

  /** Primeiro lock de toda tx de chunk: regra -> items. Além de renovar o
   * heartbeat, impede finalizadores antigos de tocar uma execução mais nova. */
  private async touchOwner(
    em: EntityManager,
    report: OfferBookRuleExecutionReportEntity,
  ): Promise<boolean> {
    const result = await em.getRepository(OfferBookRuleEntity).update(
      {
        id: report.ruleId,
        status: OfferBookRuleStatus.RUNNING,
        activeExecutionReportId: report.id,
      },
      { updatedAt: new Date() },
    );
    return (result.affected ?? 0) > 0;
  }

  private itemsByStatus(
    em: EntityManager,
    reportId: string,
    status: 'pending' | 'erp_applied',
  ): Promise<PendingItem[]> {
    return em.query(
      `SELECT i.id, i.ean::text AS ean, i.final_price AS "finalPrice",
              i.external_id AS "externalId"
         FROM offer_book_rule_execution_report_item i
        WHERE i.report_id = $1 AND i.apply_status = $2
        ORDER BY i.ean
        LIMIT ${A7_CHUNK}`,
      [reportId, status],
    );
  }

  /** Espelho local pós-push: offer_book global + product_item das lojas cujo
   * caderno vencedor é o caderno escrito. */
  private async mirror(
    em: EntityManager,
    pushed: PendingItem[],
    cadernoId: number,
  ): Promise<void> {
    await new OfferBookRepository(em).upsertManyByEan(
      pushed.map((item) => ({
        ean: item.ean,
        targetPrice: String(Number(item.finalPrice)),
        externalId: String(cadernoId),
      })),
    );
    await em.query(
      `UPDATE product_item pi
          SET price_offer = CASE WHEN v.price <= COALESCE(pi.price, p.price)
                                 THEN v.price ELSE NULL END,
              updated_at = now()
         FROM (SELECT unnest($1::bigint[]) AS ean,
                      unnest($2::numeric[]) AS price) v
         JOIN product p ON p.ean = v.ean
        WHERE p.id = pi.product_id AND pi.offer_external_id = $3::bigint`,
      [
        pushed.map((item) => item.ean),
        pushed.map((item) => Number(item.finalPrice)),
        cadernoId,
      ],
    );
  }

  /** Só fecha quando não existe trabalho local ou externo em aberto. */
  private async finalizeOwned(
    em: EntityManager,
    report: OfferBookRuleExecutionReportEntity,
  ): Promise<void> {
    const counts: Array<{
      applied: number;
      erpApplied: number;
      failed: number;
      pending: number;
      skipped: number;
      total: number;
    }> = await em.query(
      `SELECT count(*) FILTER (WHERE apply_status = 'applied')::int AS applied,
              count(*) FILTER (WHERE apply_status = 'erp_applied')::int AS "erpApplied",
              count(*) FILTER (WHERE apply_status = 'failed')::int AS failed,
              count(*) FILTER (WHERE apply_status = 'pending')::int AS pending,
              count(*) FILTER (WHERE apply_status = 'skipped')::int AS skipped,
              count(*)::int AS total
         FROM offer_book_rule_execution_report_item
        WHERE report_id = $1`,
      [report.id],
    );
    const { applied, erpApplied, failed, pending, skipped, total } = counts[0];
    if (pending > 0 || erpApplied > 0) {
      throw new Error(
        `report ${report.id} ainda tem ${pending} pending e ${erpApplied} erp_applied`,
      );
    }

    const outcome =
      failed > 0 ? 'FAILURE' : applied > 0 ? 'SUCCESS' : 'NO_CHANGES';
    await em.query(
      `UPDATE offer_book_rule_execution_report
          SET total_products = $2, products_updated = $3, products_skipped = $4,
              outcome = $5,
              error_message = CASE WHEN $6::int > 0
                THEN $6 || ' produto(s) falharam no envio ao ERP' ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [report.id, total, applied, skipped, outcome, failed],
    );

    const ruleStatus =
      failed === 0
        ? OfferBookRuleStatus.SUCCEEDED
        : applied > 0
          ? OfferBookRuleStatus.PARTIALLY_SUCCEEDED
          : OfferBookRuleStatus.ERRORED;
    const finalized = await em.getRepository(OfferBookRuleEntity).update(
      {
        id: report.ruleId,
        status: OfferBookRuleStatus.RUNNING,
        activeExecutionReportId: report.id,
      },
      {
        status: ruleStatus,
        activeExecutionReportId: null,
        updatedAt: new Date(),
      },
    );
    if (!(finalized.affected ?? 0))
      throw new Error(`report ${report.id} perdeu ownership ao finalizar`);

    this.logger.log(
      `execução ${report.id}: ${applied} aplicados, ${skipped} pulados, ` +
        `${failed} falhas → ${outcome}/${ruleStatus}`,
    );
  }

  private async pendingIds(
    em: EntityManager,
    reportId: string,
  ): Promise<string[]> {
    const rows: Array<{ id: string }> = await em.query(
      `SELECT id FROM offer_book_rule_execution_report_item
        WHERE report_id = $1 AND apply_status = 'pending'`,
      [reportId],
    );
    return rows.map((row) => row.id);
  }

  private async markMany(
    em: EntityManager,
    ids: string[],
    status: 'erp_applied' | 'applied' | 'failed',
    error: string | null,
  ): Promise<void> {
    if (ids.length === 0) return;
    await em.query(
      `UPDATE offer_book_rule_execution_report_item
          SET apply_status = $2, apply_error = $3,
              was_updated = ($2 IN ('erp_applied', 'applied')),
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, status, error],
    );
  }
}
