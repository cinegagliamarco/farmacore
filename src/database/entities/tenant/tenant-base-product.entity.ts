import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'tenant_base_product' })
@Index('UQ_TENANT_BASE_PRODUCT_EAN', ['ean'], { unique: true })
@Index('UQ_TENANT_BASE_PRODUCT_EXTERNAL_ID', ['externalId'], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
export class TenantBaseProductEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  public externalId?: string | null;
}
