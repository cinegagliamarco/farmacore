import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantProductRepository } from '../../database/repositories/tenant/tenant-product.repository';
import { StatusSettingsEntity } from '../../database/entities/tenant/status-settings.entity';

interface StatusThresholds {
  suspectBelow: number;
  attentionBelow: number;
  attentionAbove: number;
  suspectAbove: number;
}

const DEFAULT_THRESHOLDS: StatusThresholds = {
  suspectBelow: -15,
  attentionBelow: 0,
  attentionAbove: 20,
  suspectAbove: 50,
};

interface MetricRow {
  ean: string;
  cost: string | null;
  price: string | null;
  drogal_price: string | null;
  drogasil_price: string | null;
  target_price: string | null;
}

/**
 * Per-batch computation of margin / averageVariation / status for a
 * slice of EANs. Reads:
 *   - tenant.status_settings.settings (jsonb thresholds, with defaults)
 *   - tenant.tenant_product (cost, price)
 *   - shared_catalog.product (DROGAL + DROGASIL competitor prices)
 *   - tenant.offer_book (target_price)
 *
 * Writes:
 *   - tenant.tenant_product.margin / average_variation / status
 *
 * Cross-schema joins are safe inside runWithTenant because each entity
 * declares its schema; the per-batch UPDATE goes via TenantProductRepository.
 */
@Injectable()
export class CalcBaseProductMetricsStep {
  private readonly logger = new Logger(CalcBaseProductMetricsStep.name);

  public async run(em: EntityManager, eans: string[]): Promise<void> {
    if (eans.length === 0) return;

    const thresholds = await this.loadThresholds(em);

    const rows: MetricRow[] = await em.query(
      `SELECT
         tp.ean,
         tp.cost,
         tp.price,
         drogal.price AS drogal_price,
         drogasil.price AS drogasil_price,
         ob.target_price
       FROM tenant_product tp
       LEFT JOIN shared_catalog.product drogal
         ON drogal.ean = tp.ean AND drogal.origin = 'DROGAL'
       LEFT JOIN shared_catalog.product drogasil
         ON drogasil.ean = tp.ean AND drogasil.origin = 'DROGASIL'
       LEFT JOIN offer_book ob ON ob.ean = tp.ean
       WHERE tp.ean = ANY($1::bigint[])`,
      [eans],
    );

    const updates = rows.map((r) => this.computeMetrics(r, thresholds));
    await new TenantProductRepository(em).updateMetricsBatch(updates);

    this.logger.debug(
      `calc-base-product-metrics batch: ${updates.length} rows updated`,
    );
  }

  private async loadThresholds(em: EntityManager): Promise<StatusThresholds> {
    const row = await em.getRepository(StatusSettingsEntity).findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    const s = (row?.settings ?? {}) as Partial<StatusThresholds>;
    return {
      suspectBelow: s.suspectBelow ?? DEFAULT_THRESHOLDS.suspectBelow,
      attentionBelow: s.attentionBelow ?? DEFAULT_THRESHOLDS.attentionBelow,
      attentionAbove: s.attentionAbove ?? DEFAULT_THRESHOLDS.attentionAbove,
      suspectAbove: s.suspectAbove ?? DEFAULT_THRESHOLDS.suspectAbove,
    };
  }

  private computeMetrics(
    r: MetricRow,
    t: StatusThresholds,
  ): {
    ean: string;
    margin: number | null;
    averageVariation: number | null;
    status: string | null;
  } {
    const cost = Number(r.cost) || 0;
    const priceForSell = Number(r.price) || 0;
    const priceForOffer = Number(r.target_price) || 0;
    const basePrice = priceForOffer || priceForSell;

    const margin = basePrice > 0 ? ((basePrice - cost) / basePrice) * 100 : null;

    const drogalPrice = Number(r.drogal_price) || 0;
    const drogasilPrice = Number(r.drogasil_price) || 0;
    const validCount =
      (drogalPrice > 0 ? 1 : 0) + (drogasilPrice > 0 ? 1 : 0);
    const avgCompetitor =
      validCount > 0 ? (drogalPrice + drogasilPrice) / validCount : 0;
    const averageVariation =
      avgCompetitor > 0
        ? ((basePrice - avgCompetitor) / avgCompetitor) * 100
        : null;

    return {
      ean: r.ean,
      margin,
      averageVariation,
      status: statusForVariation(averageVariation, t),
    };
  }
}

export function statusForVariation(
  averageVariation: number | null,
  t: StatusThresholds,
): string | null {
  if (averageVariation == null) return null;
  if (averageVariation > t.suspectAbove) return 'SUSPEITA';
  if (averageVariation >= t.attentionAbove) return 'ATENÇÃO';
  if (averageVariation >= t.attentionBelow) return 'OK';
  if (averageVariation >= t.suspectBelow) return 'ATENÇÃO';
  return 'SUSPEITA';
}
