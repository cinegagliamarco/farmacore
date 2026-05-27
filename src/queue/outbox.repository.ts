import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { PipelineOutboxEntity } from '../database/entities/core/pipeline-outbox.entity';
import { EXCHANGE_NAME } from './constants';
import { PipelineMessage } from './types';

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
      message: m,
    }));
    await em
      .getRepository(PipelineOutboxEntity)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(rows as any);
  }

  /**
   * Claim a batch of unpublished rows. Two-step:
   *   1. UPDATE...RETURNING with FOR UPDATE SKIP LOCKED to atomically
   *      bump the attempts counter for picked rows. Multiple publisher
   *      instances can run concurrently without double-publishing.
   *   2. Re-fetch via the typed repo so callers get camelCase fields.
   */
  public async claimPending(
    limit: number,
  ): Promise<PipelineOutboxEntity[]> {
    const picked: Array<{ id: string }> = await this.repo.query(
      `WITH chosen AS (
        SELECT id FROM core.pipeline_outbox
        WHERE published_at IS NULL
        ORDER BY created_at ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED
      )
      UPDATE core.pipeline_outbox
      SET attempts = attempts + 1, updated_at = now()
      WHERE id IN (SELECT id FROM chosen)
      RETURNING id`,
      [limit],
    );
    if (picked.length === 0) return [];
    return this.repo.find({ where: picked.map((p) => ({ id: p.id })) });
  }

  public async markPublished(id: string): Promise<void> {
    await this.repo.update(
      { id, publishedAt: IsNull() },
      { publishedAt: new Date() },
    );
  }
}

export { EXCHANGE_NAME };
