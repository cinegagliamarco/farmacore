import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { StoreClusterEntity } from './store-cluster.entity';
import { TenantEntity } from './tenant.entity';

/**
 * Per-tenant store (business unit). Synced from the A7Pharma
 * `unidadenegocio` table, matched/deduped by CNPJ. `external_id`
 * (`unidadenegocio.id`) drives per-store ERP reads/writes. Control-plane
 * config, so it lives in core keyed by tenant_id.
 */
@Entity({ schema: 'core', name: 'tenant_store' })
@Index('UQ_TENANT_STORE_EXTERNAL_ID', ['tenantId', 'externalId'], {
  unique: true,
})
@Index('UQ_TENANT_STORE_CNPJ', ['tenantId', 'cnpj'], {
  unique: true,
  where: '"cnpj" IS NOT NULL',
})
export class TenantStoreEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'external_id', type: 'bigint' })
  public externalId!: string;

  @Column({ type: 'text' })
  public name!: string;

  // Nullable: legacy rows predate this column and stay NULL until the
  // first store sync backfills them.
  @Column({ type: 'text', nullable: true })
  public cnpj?: string | null;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @Column({ name: 'cluster_id', type: 'uuid', nullable: true })
  public clusterId?: string | null;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;

  @ManyToOne(() => StoreClusterEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cluster_id' })
  public cluster?: StoreClusterEntity | null;
}
