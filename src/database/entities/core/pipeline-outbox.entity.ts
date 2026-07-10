import { Column, Entity, Index } from 'typeorm';
import { PipelineStep } from '../../enums/pipeline-step.enum';
import { BaseEntity } from '../base.entity';

/** Wire shape stored in pipeline_outbox.message (jsonb). */
export interface PipelineOutboxMessage {
  pipelineRunId: string;
  tenantId: string;
  step: PipelineStep;
  queue?: string;
  attempt: number;
  publishedAt: string;
  payload: object;
  batchSeq?: number;
  standalone?: boolean;
}

/**
 * Successor messages staged inside the consumer's tenant transaction.
 * A scheduled publisher (OutboxPublisher) reads `published_at IS NULL`
 * rows + publishes them to RMQ + marks them. Closes bug #1 window 2
 * (crash between the SQL commit and the AMQP publish).
 *
 * The (pipeline_run_id, routing_key, message) tuple gives ops enough
 * to manually replay a stuck message if needed.
 */
@Entity({ schema: 'core', name: 'pipeline_outbox' })
@Index('IX_PIPELINE_OUTBOX_RUN', ['pipelineRunId'])
// Partial index for the publisher's "what's pending" scan.
@Index('IX_PIPELINE_OUTBOX_PENDING', ['createdAt'], {
  where: 'published_at IS NULL',
})
export class PipelineOutboxEntity extends BaseEntity {
  @Column({ name: 'pipeline_run_id', type: 'uuid' })
  public pipelineRunId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ name: 'routing_key', type: 'text' })
  public routingKey!: string;

  @Column({ type: 'jsonb' })
  public message!: PipelineOutboxMessage;

  @Column({ type: 'int', default: 0 })
  public attempts!: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  public publishedAt?: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  public claimedAt?: Date | null;
}
