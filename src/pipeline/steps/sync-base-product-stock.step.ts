import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { A7PharmaRepositories } from '../../integration/repositories/a7pharma';
import {
  TenantProductStockRepository,
  TenantProductStockUpsertInput,
} from '../../database/repositories/tenant/tenant-product-stock.repository';

export interface SyncBaseProductStockBatchResult {
  processed: number;
  skipped: number;
}

/**
 * Per-batch business logic for sync-base-product-stock. Pure use-case:
 * reads a slice of embalagens + their estoque rows from the ERP, sums
 * quantities by (ean, subsidiary), and upserts into tenant_product_stock.
 *
 * Divergence from legacy:
 *  - No SubsidiaryMaping enum: every store id is imported. Labels live
 *    in tenant_subsidiary, configured per-tenant during onboarding.
 *  - No deleteByBaseProductId before insert: dispatcher restart safety.
 *    Stale rows for EANs that disappear from the ERP accumulate; a
 *    follow-up cleanup pass can reconcile.
 *  - Stock rows for this batch are bounded-deleted by EAN before
 *    upsert, so a subsidiary that fell to zero (no longer in estoque)
 *    is removed in the same batch that refreshes its peers.
 */
@Injectable()
export class SyncBaseProductStockStep {
  private readonly logger = new Logger(SyncBaseProductStockStep.name);

  public async run(
    em: EntityManager,
    integrationDs: DataSource | null,
    embalagemIds: number[],
  ): Promise<SyncBaseProductStockBatchResult> {
    if (!integrationDs) {
      this.logger.warn(
        'Skipping sync-base-product-stock batch: integration DataSource not available',
      );
      return { processed: 0, skipped: embalagemIds.length };
    }
    if (embalagemIds.length === 0) return { processed: 0, skipped: 0 };

    const a7 = new A7PharmaRepositories(integrationDs);
    const stockRepo = new TenantProductStockRepository(em);

    const embalagens = await a7.embalagem.findByIdsWithRelations(embalagemIds);
    if (embalagens.length === 0) return { processed: 0, skipped: 0 };

    // EAN lookup per embalagem (so estoque rows that reference an
    // embalagem with no parseable barcode can be dropped early).
    const eanByEmbalagemId = new Map<string, string>();
    let skipped = 0;
    for (const e of embalagens) {
      const ean = this.parseEan(e.codigobarras);
      if (!ean) {
        skipped++;
        continue;
      }
      eanByEmbalagemId.set(String(e.id), ean);
    }
    if (eanByEmbalagemId.size === 0) return { processed: 0, skipped };

    const validEmbalagemIds = Array.from(eanByEmbalagemId.keys()).map((s) =>
      Number(s),
    );
    const estoques = await a7.estoque.findByEmbalagemIds(validEmbalagemIds);

    // Sum quantities per (ean, subsidiary). An embalagem appears at
    // most once in estoque per subsidiary (UNIQUE index), but two
    // embalagens sharing a barcode would otherwise double-count, so we
    // aggregate at the EAN level too.
    const sumByPair = new Map<string, TenantProductStockUpsertInput>();
    for (const row of estoques) {
      const ean = eanByEmbalagemId.get(String(row.embalagemid));
      if (!ean) continue;
      const subId = String(row.unidadenegocioid);
      const key = `${ean}|${subId}`;
      const qty = Math.floor(Number(row.estoque) || 0);
      if (qty <= 0) continue;
      const existing = sumByPair.get(key);
      if (existing) {
        existing.quantity += qty;
      } else {
        sumByPair.set(key, {
          ean,
          subsidiaryExternalId: subId,
          quantity: qty,
        });
      }
    }

    const inputs = Array.from(sumByPair.values());

    // Drop any prior rows for the EANs we're about to refresh so a
    // subsidiary that went to zero (not in the new inputs) is removed
    // in the same batch — without touching other batches' EANs.
    const eans = Array.from(eanByEmbalagemId.values());
    await stockRepo.deleteByEans(eans);

    await stockRepo.upsertMany(inputs);

    this.logger.debug(
      `sync-base-product-stock batch: ${inputs.length} stock rows across ${eans.length} eans, ${skipped} skipped`,
    );
    return { processed: inputs.length, skipped };
  }

  private parseEan(codigobarras?: string): string | null {
    if (!codigobarras) return null;
    const cleaned = codigobarras.replace(/\D/g, '');
    if (!cleaned.length || cleaned.length > 14) return null;
    const padded = cleaned.padStart(13, '0');
    const numeric = Number(padded);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return padded.replace(/^0+(?=\d)/, '') || '0';
  }
}
