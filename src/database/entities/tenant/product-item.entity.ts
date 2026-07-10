import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ProductEntity } from './product.entity';

/**
 * Per-store projection of a tenant product's price/cost/offer. `store_id` is
 * a logical ref to core.tenant_store(id) (resolved in code — no cross-schema
 * FK). Only synced for active stores. The offer is per-store: which caderno
 * applies at each store comes from the ERP's caderno↔store participation
 * (unidadenegocioparticipantecadernooferta; a caderno with no participants
 * covers every store). `offer_external_id`/`offer_description` identify the
 * store's winning caderno; `price_offer` is its computed offer price, NULL
 * when it doesn't undercut the store's shelf price.
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

  /** A7Pharma caderno id (write-back target for this store's offer). */
  @Column({ name: 'offer_external_id', type: 'bigint', nullable: true })
  public offerExternalId?: string | null;

  @Column({ name: 'offer_description', type: 'text', nullable: true })
  public offerDescription?: string | null;

  @ManyToOne(() => ProductEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  public product?: ProductEntity;
}
