import { EntityManager } from 'typeorm';
import { ProductItemEntity } from '../../entities/tenant/product-item.entity';

export interface ProductItemUpsertInput {
  productId: string;
  storeId: string;
  price: string | null;
  priceOffer: string | null;
  cost: string | null;
}

/**
 * Per-tenant product_item repository — (product_id, store_id) keyed.
 * Upsert is idempotent across pipeline reruns; rows for deactivated
 * stores are left in place (the sync only writes active stores).
 */
export class ProductItemRepository {
  constructor(private readonly em: EntityManager) {}

  public async upsertMany(inputs: ProductItemUpsertInput[]): Promise<void> {
    if (inputs.length === 0) return;
    await this.em.getRepository(ProductItemEntity).upsert(inputs, {
      conflictPaths: ['productId', 'storeId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }
}
