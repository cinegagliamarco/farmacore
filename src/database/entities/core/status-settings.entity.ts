import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Per-tenant status-threshold settings (jsonb bag) read by the
 * calc-base-product-metrics step. Control-plane config, so it lives in
 * core keyed by tenant_id.
 */
@Entity({ schema: 'core', name: 'status_settings' })
@Index('IX_STATUS_SETTINGS_TENANT', ['tenantId'])
export class StatusSettingsEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'jsonb', default: {} })
  public settings!: Record<string, unknown>;
}
