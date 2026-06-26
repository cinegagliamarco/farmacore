import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ClassificationEntity } from './classification.entity';

/**
 * Per-tenant projection of a shared catalog product. The intrinsic facts
 * (EAN, dimensions, generic flag, active ingredient text, description)
 * live in shared_catalog.base_product; this row carries everything that
 * is tenant-scoped and ERP-sourced: ERP id, ERP name, pricing, supplier,
 * receipt date, monitored flag, classification FK, and the legacy
 * `deals` jsonb (per-quantity offer payload).
 */
@Entity({ name: 'product' })
@Index('UQ_PRODUCT_EAN', ['ean'], { unique: true })
@Index('UQ_PRODUCT_EXTERNAL_ID', ['externalId'], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
@Index('IX_PRODUCT_CLASSIFICATION', ['classificationId'])
export class ProductEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  public externalId?: string | null;

  @Column({ type: 'text', nullable: true })
  public name?: string | null;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  public price?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  public cost?: string | null;

  @Column({
    name: 'average_unit_cost',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  public averageUnitCost?: string | null;

  @Column({
    name: 'unit_sale_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public unitSalePrice?: string | null;

  @Column({ type: 'text', nullable: true })
  public supplier?: string | null;

  @Column({ name: 'receipt_date', type: 'date', nullable: true })
  public receiptDate?: Date | string | null;

  @Column({ type: 'boolean', default: false })
  public monitored!: boolean;

  @Column({ name: 'classification_id', type: 'uuid', nullable: true })
  public classificationId?: string | null;

  @ManyToOne(() => ClassificationEntity, (classification) => classification.products, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'classification_id' })
  public classification?: ClassificationEntity | null;

  @Column({ type: 'jsonb', nullable: true })
  public deals?: Record<string, ProductDeal> | null;

  @Column({ type: 'numeric', precision: 8, scale: 4, nullable: true })
  public margin?: string | null;

  @Column({
    name: 'average_variation',
    type: 'numeric',
    precision: 8,
    scale: 4,
    nullable: true,
  })
  public averageVariation?: string | null;

  @Column({ type: 'text', nullable: true })
  public status?: string | null;

  // Base-product identity, denormalized here so the system build-base-
  // products routine aggregates base_product from tenant rows (plan 10).
  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'active_ingredient', type: 'text', nullable: true })
  public activeIngredient?: string | null;

  @Column({ type: 'boolean', default: false })
  public generic!: boolean;
}

export interface ProductDeal {
  totalPrice: number;
  discount: number;
  itemCadernoOfertaId?: number | null;
}
