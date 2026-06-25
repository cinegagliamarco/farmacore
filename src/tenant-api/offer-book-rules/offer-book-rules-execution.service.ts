import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { A7PharmaApiClient } from '../../integration/a7-pharma-api.client';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { PreviewProductResult } from './dto/preview-offer-book-rules.dto';
import { OfferBookRulesManagementService } from './offer-book-rules-management.service';

export type ExecutionOutcome = 'SUCCESS' | 'FAILURE' | 'NO_CHANGES';

export interface ExecuteResult {
  ruleId: string;
  executionReportId: string;
  totalProducts: number;
  productsUpdated: number;
  productsSkipped: number;
  outcome: ExecutionOutcome;
  startedAt: Date;
}

const ERP_BATCH = 80;
const PER_PAGE = 1000;

/**
 * Applies a saved rule: computes each product's price and writes it as the
 * offer price (precoOferta) into the rule's caderno on the ERP, in batches,
 * recording a full execution report. Manual trigger only — the legacy
 * scheduled run was dropped with the scheduling table.
 *
 * Never throws on an ERP batch failure: the error is recorded on the report and
 * the request returns so the report (and the prices already applied) commit.
 * Only pre-flight problems (unknown rule / no caderno / no ERP credentials)
 * throw, before anything is written.
 *
 * v1 runs synchronously inside the request transaction. The legacy 5s
 * inter-batch delay and the RUNNING-status concurrency lock are deferred — see
 * the migration plan doc.
 */
@Injectable()
export class OfferBookRulesExecutionService {
  constructor(
    private readonly mgmt: OfferBookRulesManagementService,
    private readonly integration: IntegrationConnectionService,
    private readonly a7: A7PharmaApiClient,
  ) {}

  public async execute(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<ExecuteResult> {
    const rule = await this.mgmt.getById(em, id); // 404 if missing
    if (!rule.cadernoId)
      throw new BadRequestException(
        'rule has no target caderno (cadernoId) to execute into',
      );
    const creds = await this.integration.getApiCredentials(slug);
    if (!creds)
      throw new ConflictException(
        'A7Pharma API not configured for this tenant',
      );
    const cadernoId = Number(rule.cadernoId);

    const rows = await this.allPreviewRows(em, slug, id);
    const updatable = rows.filter(
      (r) =>
        !r.skippedNoCompetitorPrice &&
        !r.skippedPriceExceedsLimit &&
        r.externalId != null &&
        r.finalPrice > 0,
    );
    const skipped = rows.filter((r) => !updatable.includes(r));

    const startedAt = new Date();
    const [{ id: reportId }]: Array<{ id: string }> = await em.query(
      `INSERT INTO offer_book_rule_execution_report
         (rule_id, execution_type, calculation_base_type, started_at,
          total_products, products_skipped)
       VALUES ($1,'MANUAL',$2,$3,$4,$5) RETURNING id`,
      [id, rule.calculationBaseType, startedAt, rows.length, skipped.length],
    );
    await this.insertItems(em, reportId, skipped, false);

    const errors: string[] = [];
    let updated = 0;
    for (let i = 0; i < updatable.length; i += ERP_BATCH) {
      const chunk = updatable.slice(i, i + ERP_BATCH);
      try {
        await this.a7.upsertOffer(
          creds,
          cadernoId,
          chunk.map((r) => ({
            idEmbalagem: Number(r.externalId),
            precoOferta: r.finalPrice,
          })),
        );
        await this.mirrorOffers(em, cadernoId, chunk);
        await this.insertItems(em, reportId, chunk, true);
        updated += chunk.length;
      } catch (e) {
        errors.push(
          `batch ${Math.floor(i / ERP_BATCH) + 1}: ${(e as Error).message}`,
        );
      }
    }

    const outcome: ExecutionOutcome =
      updatable.length === 0
        ? 'NO_CHANGES'
        : errors.length === 0
          ? 'SUCCESS'
          : 'FAILURE';
    await em.query(
      `UPDATE offer_book_rule_execution_report
          SET finished_at = now(), products_updated = $1, outcome = $2,
              error_message = $3
        WHERE id = $4`,
      [updated, outcome, errors.length ? errors.join('; ') : null, reportId],
    );

    return {
      ruleId: id,
      executionReportId: reportId,
      totalProducts: rows.length,
      productsUpdated: updated,
      productsSkipped: skipped.length,
      outcome,
      startedAt,
    };
  }

  /** All preview rows for the rule, paging past the engine's per-page cap. */
  private async allPreviewRows(
    em: EntityManager,
    slug: string,
    id: string,
  ): Promise<PreviewProductResult[]> {
    const all: PreviewProductResult[] = [];
    let page = 1;
    for (;;) {
      const res = await this.mgmt.previewSaved(em, slug, id, page, PER_PAGE);
      all.push(...res.rows);
      if (res.rows.length === 0 || all.length >= res.count) break;
      page++;
    }
    return all;
  }

  private async mirrorOffers(
    em: EntityManager,
    cadernoId: number,
    rows: PreviewProductResult[],
  ): Promise<void> {
    for (const r of rows) {
      await em.query(
        `INSERT INTO offer_book (ean, target_price, external_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (ean) DO UPDATE
           SET target_price = EXCLUDED.target_price,
               external_id = EXCLUDED.external_id,
               updated_at = now()`,
        [r.ean, r.finalPrice, cadernoId],
      );
    }
  }

  private async insertItems(
    em: EntityManager,
    reportId: string,
    rows: PreviewProductResult[],
    wasUpdated: boolean,
  ): Promise<void> {
    for (const r of rows) {
      await em.query(
        `INSERT INTO offer_book_rule_execution_report_item
           (report_id, ean, name, classification, base_sale_price, current_price,
            current_margin, cost, action_type, percentage_value,
            applied_percentage_value, final_price, new_margin, price_lock_applied,
            discount_skipped, skipped_no_competitor_price, skipped_price_exceeds_limit,
            price_rounding_applied, was_updated)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          reportId,
          r.ean,
          r.name,
          r.classification,
          r.baseSalePrice,
          r.currentPrice,
          r.currentMargin,
          r.cost,
          r.actionType,
          r.percentageValue,
          r.appliedPercentageValue,
          r.finalPrice,
          r.newMargin,
          r.priceLockApplied,
          r.discountSkipped,
          r.skippedNoCompetitorPrice,
          r.skippedPriceExceedsLimit,
          r.priceRoundingApplied,
          wasUpdated,
        ],
      );
    }
  }
}
