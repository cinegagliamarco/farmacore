import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';

/**
 * Per-tenant subsidiary label lookup (maps an ERP store id to a name).
 * Control-plane config, so it lives in core keyed by tenant_id rather
 * than in the tenant schema.
 */
@Entity({ schema: 'core', name: 'tenant_subsidiary' })
@Index('UQ_TENANT_SUBSIDIARY_EXTERNAL_ID', ['tenantId', 'externalId'], {
  unique: true,
})
export class TenantSubsidiaryEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'external_id', type: 'bigint' })
  public externalId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;
}
