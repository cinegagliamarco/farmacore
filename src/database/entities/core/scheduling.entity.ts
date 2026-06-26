import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';

/**
 * Per-tenant scheduled-job definition (cron + payload). Control-plane
 * config, so it lives in core keyed by tenant_id.
 */
@Entity({ schema: 'core', name: 'scheduling' })
export class SchedulingEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'cron_expression', type: 'text' })
  public cronExpression!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'jsonb', default: {} })
  public payload!: Record<string, unknown>;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;
}
