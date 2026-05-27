import { EntityManager, In } from 'typeorm';
import { ProductStockEntity } from '../../entities/tenant/product-stock.entity';

export interface ProductStockUpsertInput {
  ean: string;
  subsidiaryExternalId: string;
  quantity: number;
}

/**
 * Per-tenant stock repository — (ean, subsidiary_external_id) keyed.
 * The legacy "deleteByBaseProductId + insert" full-refresh pattern is
 * replaced with an upsert keyed on the (ean, subsidiary) pair, which
 * is idempotent across dispatcher restarts; rows for EANs/stores that
 * vanish from the ERP can be reconciled by a future cleanup pass.
 */
export class ProductStockRepository {
  constructor(private readonly em: EntityManager) {}

  public async upsertMany(
    inputs: ProductStockUpsertInput[],
  ): Promise<void> {
    if (inputs.length === 0) return;
    const repo = this.em.getRepository(ProductStockEntity);
    const deduped = this.dedupe(inputs);
    await repo.upsert(deduped, {
      conflictPaths: ['ean', 'subsidiaryExternalId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  /**
   * Wipes stock rows for the given EAN set. Used by the batch consumer
   * to drop subsidiaries whose stock fell to zero (and therefore aren't
   * in the inputs anymore) before the upsert. Bounded by batch IDs so
   * concurrent batches don't step on each other.
   */
  public async deleteByEans(eans: string[]): Promise<void> {
    if (eans.length === 0) return;
    await this.em
      .getRepository(ProductStockEntity)
      .delete({ ean: In(eans) });
  }

  private dedupe(
    inputs: ProductStockUpsertInput[],
  ): ProductStockUpsertInput[] {
    const byPair = new Map<string, ProductStockUpsertInput>();
    for (const i of inputs) {
      byPair.set(`${i.ean}|${i.subsidiaryExternalId}`, i);
    }
    return [...byPair.values()];
  }
}
