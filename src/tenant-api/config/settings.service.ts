import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import { VariationStatusDto } from './dto/config.dto';

/**
 * Variation-status thresholds drive the OK/ATENÇÃO/SUSPEITA classification in
 * calc-base-product-metrics.step. Stored per-tenant in core.status_settings;
 * the step falls back to these same defaults when no row exists.
 */
const DEFAULTS = {
  suspectBelow: -15,
  attentionBelow: 0,
  attentionAbove: 20,
  suspectAbove: 50,
};

type Thresholds = typeof DEFAULTS;

@Injectable()
export class SettingsService {
  public async getVariationStatus(
    em: EntityManager,
    slug: string,
  ): Promise<Thresholds> {
    const tenantId = await resolveTenantId(em, slug);
    const rows: Array<{ settings: Partial<Thresholds> }> = await em.query(
      `SELECT settings FROM core.status_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    return { ...DEFAULTS, ...(rows[0]?.settings ?? {}) };
  }

  public async updateVariationStatus(
    em: EntityManager,
    slug: string,
    patch: VariationStatusDto,
  ): Promise<Thresholds> {
    const tenantId = await resolveTenantId(em, slug);
    const merged = await this.getVariationStatus(em, slug);
    // The DTO carries all fields as own props (ValidationPipe transform), so
    // unset ones are `undefined` — copy only what the caller actually sent.
    for (const key of Object.keys(merged) as Array<keyof Thresholds>) {
      const value = patch[key];
      if (value !== undefined) merged[key] = value;
    }
    const existing: Array<{ id: string }> = await em.query(
      `SELECT id FROM core.status_settings WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    if (existing.length)
      await em.query(
        `UPDATE core.status_settings SET settings = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(merged), existing[0].id],
      );
    else
      await em.query(
        `INSERT INTO core.status_settings (tenant_id, settings) VALUES ($1, $2)`,
        [tenantId, JSON.stringify(merged)],
      );
    return merged;
  }
}
