import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { PipelineOutboxEntity, PipelineOutboxMessage } from '../database/entities/core/pipeline-outbox.entity';
import { PipelineMessage } from './types';

interface PipelineOutboxRow {
  id: string;
  pipeline_run_id: string;
  tenant_id: string;
  routing_key: string;
  message: PipelineOutboxMessage;
  attempts: number;
  claimed_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

function rowToEntity(r: PipelineOutboxRow): PipelineOutboxEntity {
  return {
    id: r.id,
    pipelineRunId: r.pipeline_run_id,
    tenantId: r.tenant_id,
    routingKey: r.routing_key,
    message: r.message,
    attempts: r.attempts,
    claimedAt: r.claimed_at,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

/**
 * Lease window: a claimed row is excluded from re-claim until this
 * many ms have passed since claimed_at. Comfortably larger than a
 * normal publish (broker round-trip is sub-second) so happy-path
 * publishes never race their own lease; short enough that a crashed
 * publisher's row is reclaimable within 60s.
 */
const CLAIM_GRACE_MS = 60_000;

@Injectable()
export class OutboxRepository {
  constructor(
    @InjectRepository(PipelineOutboxEntity)
    private readonly repo: Repository<PipelineOutboxEntity>,
  ) {}

  /**
   * Insert successor messages STAGED inside a tenant tx. The publisher
   * (separate scheduled service) picks them up on the next tick. Each
   * row carries the message + routing_key + run id; that's everything
   * AmqpConnection.publish needs.
   */
  public async insertMany(
    em: EntityManager,
    pipelineRunId: string,
    tenantId: string,
    successors: PipelineMessage<unknown>[],
  ): Promise<void> {
    if (successors.length === 0) return;
    const rows = successors.map((m) => ({
      pipelineRunId,
      tenantId,
      routingKey: `${m.tenantId}.${m.queue ?? m.step}`,
      message: m as PipelineOutboxMessage,
    }));
    await em.getRepository(PipelineOutboxEntity).insert(rows);
  }

  /** Stage batch messages from dispatch (core schema, no tenant tx). */
  public async insertBatchMessages(
    pipelineRunId: string,
    tenantId: string,
    messages: PipelineMessage<unknown>[],
  ): Promise<void> {
    if (messages.length === 0) return;
    const rows = messages.map((m) => ({
      pipelineRunId,
      tenantId,
      routingKey: `${m.tenantId}.${m.queue ?? m.step}`,
      message: m as PipelineOutboxMessage,
    }));
    await this.repo.insert(rows);
  }

  /**
   * Claim a batch of unpublished rows with a lease.
   *
   * The SKIP LOCKED row lock only holds for the duration of this UPDATE
   * statement — once it commits, the row is unlocked while
   * AmqpConnection.publish is still in flight. Without the lease,
   * another tick would re-pick and double-publish. claimed_at + a
   * CLAIM_GRACE_MS window solve that: a row claimed in the last grace
   * window is excluded from subsequent claims. A crashed publisher's
   * row becomes claimable again after the grace expires.
   */
  public async claimPending(limit: number): Promise<PipelineOutboxEntity[]> {
    // TypeORM's query() for UPDATE/INSERT/DELETE returns
    // `[returningRows, rowCount]`, not the rows array. Destructure
    // so we only iterate the actual rows.
    const result: unknown = await this.repo.query(
      `WITH chosen AS (
        SELECT id FROM core.pipeline_outbox
        WHERE published_at IS NULL
          AND (claimed_at IS NULL
               OR claimed_at < now() - ($2::int * interval '1 millisecond'))
        ORDER BY created_at ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      UPDATE core.pipeline_outbox
      SET attempts = attempts + 1, claimed_at = now(), updated_at = now()
      WHERE id IN (SELECT id FROM chosen)
      RETURNING id, pipeline_run_id, tenant_id, routing_key, message,
                attempts, claimed_at, published_at, created_at, updated_at,
                deleted_at`,
      [limit, CLAIM_GRACE_MS],
    );
    const [rows] = result as [PipelineOutboxRow[], number];
    return rows.map(rowToEntity);
  }

  public async markPublished(id: string): Promise<void> {
    await this.repo.update(
      { id, publishedAt: IsNull() },
      { publishedAt: new Date() },
    );
  }
}
