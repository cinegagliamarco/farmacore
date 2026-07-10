import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OfferBookRuleExecutionReportEntity } from '../../database/entities/tenant/offer-book-rule-execution-report.entity';
import { OfferBookRuleStatus } from '../../database/enums/offer-book-rule-status.enum';
import { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { OfferBookRepository } from '../../database/repositories/tenant/offer-book.repository';

/** Itens por POST à A7 (mesmo chunk do legado; o endpoint aceita array). */
const A7_CHUNK = 80;

interface PendingItem {
  id: string;
  ean: string;
  finalPrice: string;
  externalId: string | null;
}

/**
 * Lado do worker da execução de regra de oferta: empurra à A7 os items
 * `pending` do report (preços já congelados no POST /execute) e finaliza o
 * report + o status da regra. Money-safe como o ApplyPriceStep: **nunca
 * re-lança** por falha de push (o item vira `failed` e o loop segue) e só
 * processa `pending` — redelivery pula o que já foi `applied`, e mesmo um
 * re-push pós-crash reenvia os MESMOS valores congelados (upsert idempotente
 * no ERP). `FOR UPDATE SKIP LOCKED` particiona o trabalho se duas entregas
 * escaparem do lock do consumer.
 */
@Injectable()
export class ExecuteOfferBookRuleStep {
  private readonly logger = new Logger(ExecuteOfferBookRuleStep.name);

  constructor(
    private readonly integration: IntegrationConnectionService,
    private readonly a7: A7PharmaApiClient,
  ) {}

  public async run(
    em: EntityManager,
    tenantSlug: string,
    reportId: string,
  ): Promise<void> {
    const report = await em
      .getRepository(OfferBookRuleExecutionReportEntity)
      .findOne({ where: { id: reportId } });
    if (!report) {
      // Report sumiu (regra deletada em cascade entre o POST e o consumo).
      this.logger.warn(`report ${reportId} não existe mais; nada a executar`);
      return;
    }
    const cadernoId = Number(report.offerBookInfoId);

    const creds = await this.integration.getApiCredentials(tenantSlug);
    if (!creds) {
      await this.markMany(
        em,
        await this.pendingIds(em, reportId),
        'failed',
        'a7_nao_configurado',
      );
      await this.finalize(em, report);
      return;
    }

    for (;;) {
      const chunk: PendingItem[] = await em.query(
        `SELECT i.id, i.ean::text AS ean, i.final_price AS "finalPrice",
                p.external_id::text AS "externalId"
           FROM offer_book_rule_execution_report_item i
           LEFT JOIN product p ON p.ean = i.ean
          WHERE i.report_id = $1 AND i.apply_status = 'pending'
          ORDER BY i.ean
          LIMIT ${A7_CHUNK}
          FOR UPDATE OF i SKIP LOCKED`,
        [reportId],
      );
      if (chunk.length === 0) break;

      const missing = chunk.filter((c) => !c.externalId);
      if (missing.length)
        await this.markMany(
          em,
          missing.map((c) => c.id),
          'failed',
          'sem_external_id',
        );

      const pushable = chunk.filter((c) => c.externalId);
      if (pushable.length === 0) continue;
      try {
        await this.a7.upsertOffer(
          creds,
          cadernoId,
          pushable.map((c) => ({
            idEmbalagem: Number(c.externalId),
            precoOferta: Number(c.finalPrice),
          })),
        );
        await this.mirror(em, pushable, cadernoId);
        await this.markMany(
          em,
          pushable.map((c) => c.id),
          'applied',
          null,
        );
      } catch (err) {
        // Falha do chunk (rede/HTTP da A7): items viram `failed` e o loop
        // segue — re-lançar rolaria a tx e re-empurraria chunks já aplicados.
        this.logger.error(
          `push A7 falhou (report ${reportId}, ${pushable.length} itens): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        await this.markMany(
          em,
          pushable.map((c) => c.id),
          'failed',
          'erro_transitorio',
        );
      }
    }

    await this.finalize(em, report);
  }

  /** Espelho local pós-push (mesma semântica do catalog-mutation, em lote):
   *  offer_book global + product_item das lojas cujo caderno vencedor é este. */
  private async mirror(
    em: EntityManager,
    pushed: PendingItem[],
    cadernoId: number,
  ): Promise<void> {
    await new OfferBookRepository(em).upsertManyByEan(
      pushed.map((c) => ({
        ean: c.ean,
        targetPrice: String(Number(c.finalPrice)),
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
        pushed.map((c) => c.ean),
        pushed.map((c) => Number(c.finalPrice)),
        cadernoId,
      ],
    );
  }

  /** Fecha o report (contadores derivados dos items — consistente mesmo com
   *  trabalho particionado) e o status da regra (D6: qualquer falha ≠ SUCCESS). */
  private async finalize(
    em: EntityManager,
    report: OfferBookRuleExecutionReportEntity,
  ): Promise<void> {
    const counts: Array<{
      applied: number;
      failed: number;
      skipped: number;
      total: number;
    }> = await em.query(
      `SELECT count(*) FILTER (WHERE apply_status = 'applied')::int AS applied,
                count(*) FILTER (WHERE apply_status = 'failed')::int AS failed,
                count(*) FILTER (WHERE apply_status = 'skipped')::int AS skipped,
                count(*)::int AS total
           FROM offer_book_rule_execution_report_item
          WHERE report_id = $1`,
      [report.id],
    );
    const { applied, failed, skipped, total } = counts[0];

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
    await em.query(
      `UPDATE offer_book_rule SET status = $2, updated_at = now() WHERE id = $1`,
      [report.ruleId, ruleStatus],
    );
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
        WHERE report_id = $1 AND apply_status = 'pending'
        FOR UPDATE SKIP LOCKED`,
      [reportId],
    );
    return rows.map((r) => r.id);
  }

  private async markMany(
    em: EntityManager,
    ids: string[],
    status: 'applied' | 'failed',
    error: string | null,
  ): Promise<void> {
    if (ids.length === 0) return;
    await em.query(
      `UPDATE offer_book_rule_execution_report_item
          SET apply_status = $2, apply_error = $3,
              was_updated = ($2 = 'applied'),
              updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, status, error],
    );
  }
}
