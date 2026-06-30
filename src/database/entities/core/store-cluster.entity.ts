import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';

/**
 * Group of stores within a tenant. Stores reference it via
 * tenant_store.cluster_id (ON DELETE SET NULL). Distinct from
 * product_cluster, which groups EANs for pricing rules.
 */
@Entity({ schema: 'core', name: 'store_cluster' })
@Index('IX_STORE_CLUSTER_TENANT', ['tenantId'])
export class StoreClusterEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;
}
