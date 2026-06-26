import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PricingApplyItemEntity } from './pricing-apply-item.entity';

export type ApplyMode = 'agora' | 'agendado';
export type ApplyRunStatus = 'pending' | 'running' | 'done' | 'failed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Run de aplicação de preço em massa. `id` é o pipelineRunId do fan-in
 * (core.pipeline_run). Contadores denormalizados para o relatório
 * GET /pricing/apply/:id ser self-contained no schema do tenant.
 */
@Entity({ name: 'pricing_apply_run' })
@Index('UQ_PRICING_APPLY_RUN_IDEMPOTENCY', ['idempotencyKey'], { unique: true })
export class PricingApplyRunEntity extends BaseEntity {
  @Column({ name: 'idempotency_key', type: 'text' })
  public idempotencyKey!: string;

  @Column({ type: 'text', default: 'agora' })
  public mode!: ApplyMode;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  public requestedBy!: string | null;

  @Column({ type: 'text', default: 'pending' })
  public status!: ApplyRunStatus;

  @Column({ type: 'int', default: 0 })
  public total!: number;

  @Column({ type: 'int', default: 0 })
  public applied!: number;

  @Column({ type: 'int', default: 0 })
  public skipped!: number;

  @Column({ type: 'int', default: 0 })
  public failed!: number;

  // null = sem fluxo de aprovação (comportamento padrão).
  @Column({ name: 'approval_status', type: 'text', nullable: true })
  public approvalStatus!: ApprovalStatus | null;

  @OneToMany(() => PricingApplyItemEntity, (item) => item.applyRun)
  public items?: PricingApplyItemEntity[];
}
