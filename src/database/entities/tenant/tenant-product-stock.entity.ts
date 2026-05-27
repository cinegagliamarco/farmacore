import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Per-tenant ERP stock per (ean, subsidiary). Replaces the legacy
 * base_product_stock table; the new model decouples subsidiary labels
 * (tenant_subsidiary) from the import, so unknown stores can still
 * land without throwing.
 */
@Entity({ name: 'tenant_product_stock' })
@Index(
  'UQ_TENANT_PRODUCT_STOCK_EAN_SUBSIDIARY',
  ['ean', 'subsidiaryExternalId'],
  { unique: true },
)
@Index('IX_TENANT_PRODUCT_STOCK_EAN', ['ean'])
export class TenantProductStockEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'subsidiary_external_id', type: 'bigint' })
  public subsidiaryExternalId!: string;

  @Column({ type: 'int', default: 0 })
  public quantity!: number;
}
