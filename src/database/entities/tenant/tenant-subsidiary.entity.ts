import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Per-tenant subsidiary label lookup. The ERP carries opaque
 * `unidadenegocioid` numbers; this table holds the human-friendly
 * "LOJA 1" / "LOJA 2" labels each tenant configures during onboarding.
 *
 * Pure label store — sync-base-product-stock writes every store's stock
 * regardless of whether a row exists here. Unknown stores show up in
 * product_stock with no label until the operator adds one.
 */
@Entity({ name: 'tenant_subsidiary' })
@Index('UQ_TENANT_SUBSIDIARY_EXTERNAL_ID', ['externalId'], { unique: true })
export class TenantSubsidiaryEntity extends BaseEntity {
  @Column({ name: 'external_id', type: 'bigint' })
  public externalId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;
}
