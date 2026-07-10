import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { StatusSettingsEntity } from '../../database/entities/core/status-settings.entity';
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
    const row = await em.getRepository(StatusSettingsEntity).findOne({
      where: { tenantId },
    });
    return { ...DEFAULTS, ...(row?.settings ?? {}) };
  }

  public async updateVariationStatus(
    em: EntityManager,
    slug: string,
    patch: VariationStatusDto,
  ): Promise<Thresholds> {
    const tenantId = await resolveTenantId(em, slug);
    const repo = em.getRepository(StatusSettingsEntity);
    const row = await repo.findOne({ where: { tenantId } });
    const merged = { ...DEFAULTS, ...(row?.settings ?? {}) };
    for (const key of Object.keys(merged) as Array<keyof Thresholds>) {
      const value = patch[key];
      if (value !== undefined) merged[key] = value;
    }
    if (row) {
      row.settings = merged;
      await repo.save(row);
    } else {
      await repo.save(repo.create({ tenantId, settings: merged }));
    }
    return merged;
  }
}
