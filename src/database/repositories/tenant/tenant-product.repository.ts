import { EntityManager } from 'typeorm';
import {
  TenantProductDeal,
  TenantProductEntity,
} from '../../entities/tenant/tenant-product.entity';

export interface TenantProductUpsertInput {
  ean: string;
  externalId?: string | null;
  name?: string | null;
  active?: boolean;
  price?: string | null;
  cost?: string | null;
  averageUnitCost?: string | null;
  unitSalePrice?: string | null;
  supplier?: string | null;
  receiptDate?: Date | string | null;
  monitored?: boolean;
  classificationId?: string | null;
  deals?: Record<string, TenantProductDeal> | null;
}

/**
 * Per-tenant projection of a product. Writes the ERP-sourced view that
 * the shared catalog deliberately omits: external_id, name, prices,
 * supplier, receipt date, monitored flag, classification FK, deals jsonb.
 */
export class TenantProductRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Bulk upsert by `ean` (the per-tenant natural key). Like the shared
   * base_product upsert, dedupes the batch by ean and releases stale
   * external_ids so the unique constraint on external_id never trips
   * when an embalagem id is reassigned to a new barcode.
   */
  public async upsertManyByEan(
    inputs: TenantProductUpsertInput[],
  ): Promise<void> {
    if (inputs.length === 0) return;
    const repo = this.em.getRepository(TenantProductEntity);
    const deduped = this.dedupeByEan(inputs);
    await this.releaseConflictingExternalIds(deduped);
    await repo.upsert(
      deduped.map((d) => ({
        ...d,
        active: d.active ?? true,
        monitored: d.monitored ?? false,
      })),
      { conflictPaths: ['ean'], skipUpdateIfNoValuesChanged: true },
    );
  }

  private dedupeByEan(
    inputs: TenantProductUpsertInput[],
  ): TenantProductUpsertInput[] {
    const byEan = new Map<string, TenantProductUpsertInput>();
    for (const i of inputs) byEan.set(String(i.ean), i);
    return [...byEan.values()];
  }

  private async releaseConflictingExternalIds(
    chunk: TenantProductUpsertInput[],
  ): Promise<void> {
    const withExternal = chunk
      .filter((c) => c.externalId != null)
      .map((c) => ({ ean: String(c.ean), externalId: String(c.externalId) }));
    if (withExternal.length === 0) return;
    const externalIds = withExternal.map((p) => p.externalId);
    const eans = withExternal.map((p) => p.ean);
    await this.em
      .getRepository(TenantProductEntity)
      .createQueryBuilder()
      .update()
      .set({ externalId: () => 'NULL' })
      .where('external_id IN (:...externalIds)', { externalIds })
      .andWhere('ean NOT IN (:...eans)', { eans })
      .execute();
  }
}
