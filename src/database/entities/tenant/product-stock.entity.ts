import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Per-tenant ERP stock per (ean, store). Replaces the legacy
 * base_product_stock table; the new model decouples store labels
 * (tenant_store) from the import, so unknown stores can still
 * land without throwing.
 */
@Entity({ name: 'product_stock' })
@Index('UQ_PRODUCT_STOCK_EAN_STORE', ['ean', 'storeExternalId'], {
  unique: true,
})
@Index('IX_PRODUCT_STOCK_EAN', ['ean'])
export class ProductStockEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'store_external_id', type: 'bigint' })
  public storeExternalId!: string;

  @Column({ type: 'int', default: 0 })
  public quantity!: number;
}
