import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ProductEntity } from './product.entity';

/**
 * Per-store projection of a tenant product's price/cost. `store_id` is a
 * logical ref to core.tenant_store(id) (resolved in code — no cross-schema
 * FK). Only synced for active stores. `price_offer` mirrors the global
 * caderno offer price (offers have no per-store dimension on the ERP).
 */
@Entity({ name: 'product_item' })
@Index('UQ_PRODUCT_ITEM', ['productId', 'storeId'], { unique: true })
@Index('IX_PRODUCT_ITEM_STORE', ['storeId'])
export class ProductItemEntity extends BaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  public productId!: string;

  @Column({ name: 'store_id', type: 'uuid' })
  public storeId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  public price?: string | null;

  @Column({
    name: 'price_offer',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceOffer?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  public cost?: string | null;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  public product?: ProductEntity;
}
