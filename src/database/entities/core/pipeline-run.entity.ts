import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PipelineStep } from '../../enums/pipeline-step.enum';
import { PipelineRunStatus } from '../../enums/pipeline-run-status.enum';

@Entity({ schema: 'core', name: 'pipeline_run' })
@Index('IX_PIPELINE_RUN_TENANT_STEP_STARTED', ['tenantId', 'step', 'startedAt'])
@Index(
  'UQ_PIPELINE_RUN_RUN_STEP_BATCH',
  ['pipelineRunId', 'step', 'batchSeq'],
  { unique: true },
)
export class PipelineRunEntity extends BaseEntity {
  @Column({ name: 'pipeline_run_id', type: 'uuid' })
  public pipelineRunId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public step!: PipelineStep;

  @Column({ type: 'text' })
  public status!: PipelineRunStatus;

  @Column({ type: 'int', default: 1 })
  public attempt!: number;

  @Column({ name: 'batch_seq', type: 'int', default: 0 })
  public batchSeq!: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  public finishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  public error?: string | null;
}
