import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

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
export class PipelineOutboxEntity extends BaseEntity {
  @Column({ name: 'pipeline_run_id', type: 'uuid' })
  public pipelineRunId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ name: 'routing_key', type: 'text' })
  public routingKey!: string;

  @Column({ type: 'jsonb' })
  public message!: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  public attempts!: number;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  public publishedAt?: Date | null;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  public claimedAt?: Date | null;
}
