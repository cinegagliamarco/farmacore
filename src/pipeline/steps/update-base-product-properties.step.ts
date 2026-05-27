import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseProductRepository } from '../../database/repositories/shared-catalog/base-product.repository';
import {
  CompetitorProperties,
  SharedProductRepository,
} from '../../database/repositories/shared-catalog/product.repository';
import { TenantProductRepository } from '../../database/repositories/tenant/tenant-product.repository';

export type PropertiesPass = 'supplier' | 'weight' | 'name' | 'measures';

/**
 * Per-batch business logic for update-base-product-properties.
 *
 * The legacy use-case runs four sequential passes; here each pass is
 * its own batch with a `pass` discriminator. Source is always
 * shared_catalog.product (DROGAL + DROGASIL), with DROGASIL preferred
 * (matching legacy fall-through order).
 *
 *   pass='supplier' → tenant_product.supplier ← prod.supplier ?? prod.brand
 *   pass='name'     → tenant_product.name     ← prod.name
 *   pass='weight'   → base_product.weight     ← prod.weight
 *   pass='measures' → base_product.{height,length,width,weight (if null)}
 *                       ← whichever origin has dimensions
 */
@Injectable()
export class UpdateBaseProductPropertiesStep {
  private readonly logger = new Logger(UpdateBaseProductPropertiesStep.name);

  public async run(
    em: EntityManager,
    pass: PropertiesPass,
    eans: string[],
  ): Promise<void> {
    if (eans.length === 0) return;
    const competitors = await new SharedProductRepository(
      em,
    ).findPropertiesByEans(eans);
    const byEan = groupByEan(competitors);

    switch (pass) {
      case 'supplier':
        return this.runSimpleColumn(em, byEan, 'supplier', pickSupplier);
      case 'name':
        return this.runSimpleColumn(em, byEan, 'name', pickName);
      case 'weight':
        return this.runWeight(em, byEan);
      case 'measures':
        return this.runMeasures(em, byEan);
    }
  }

  private async runSimpleColumn(
    em: EntityManager,
    byEan: Map<string, OriginPair>,
    column: 'supplier' | 'name',
    pick: (pair: OriginPair) => string | null,
  ): Promise<void> {
    const updates: Array<{ ean: string; value: string | null }> = [];
    for (const [ean, pair] of byEan) {
      const value = pick(pair);
      if (value) updates.push({ ean, value });
    }
    await new TenantProductRepository(em).updateColumnByEan(column, updates);
    this.logger.debug(
      `update-properties[${column}]: ${updates.length} updates`,
    );
  }

  private async runWeight(
    em: EntityManager,
    byEan: Map<string, OriginPair>,
  ): Promise<void> {
    const updates: Array<{ ean: string; weight: string | null }> = [];
    for (const [ean, pair] of byEan) {
      const weight = pair.drogasil?.weight ?? pair.drogal?.weight ?? null;
      if (weight) updates.push({ ean, weight });
    }
    await new BaseProductRepository(em).updateWeights(updates);
    this.logger.debug(`update-properties[weight]: ${updates.length} updates`);
  }

  private async runMeasures(
    em: EntityManager,
    byEan: Map<string, OriginPair>,
  ): Promise<void> {
    const updates: Array<{
      ean: string;
      weight: string | null;
      height: string | null;
      length: string | null;
      width: string | null;
    }> = [];
    for (const [ean, pair] of byEan) {
      const source = pickMeasureSource(pair);
      if (!source) continue;
      updates.push({
        ean,
        weight: source.weight,
        height: source.height,
        length: source.length,
        width: source.width,
      });
    }
    await new BaseProductRepository(em).updateMeasures(updates);
    this.logger.debug(
      `update-properties[measures]: ${updates.length} updates`,
    );
  }
}

interface OriginPair {
  drogasil?: CompetitorProperties;
  drogal?: CompetitorProperties;
}

function groupByEan(rows: CompetitorProperties[]): Map<string, OriginPair> {
  const out = new Map<string, OriginPair>();
  for (const r of rows) {
    const existing = out.get(r.ean) ?? {};
    if (r.origin === 'DROGASIL') existing.drogasil = r;
    else if (r.origin === 'DROGAL') existing.drogal = r;
    out.set(r.ean, existing);
  }
  return out;
}

export function pickSupplier(pair: OriginPair): string | null {
  return (
    pair.drogasil?.supplier ??
    pair.drogal?.supplier ??
    pair.drogasil?.brand ??
    pair.drogal?.brand ??
    null
  );
}

export function pickName(pair: OriginPair): string | null {
  return pair.drogasil?.name ?? pair.drogal?.name ?? null;
}

/**
 * Legacy preferred DROGASIL if it had a cubic_weight (= measures
 * present); else DROGAL. The new schema dropped cubic_weight, so we
 * fall back to "has at least one dimension".
 */
export function pickMeasureSource(
  pair: OriginPair,
): CompetitorProperties | null {
  if (hasAnyMeasure(pair.drogasil)) return pair.drogasil!;
  if (hasAnyMeasure(pair.drogal)) return pair.drogal!;
  return null;
}

function hasAnyMeasure(p?: CompetitorProperties): boolean {
  return !!p && (p.height != null || p.length != null || p.width != null);
}
