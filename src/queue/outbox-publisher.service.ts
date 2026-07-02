import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Options } from 'amqplib';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import { EXCHANGE_NAME } from './constants';
import { OutboxRepository } from './outbox.repository';
import { PipelineRunService } from './pipeline-run.service';

/**
 * Drains the pipeline_outbox table on a tick. Claims rows via the
 * lease in OutboxRepository.claimPending (SKIP LOCKED row pick +
 * claimed_at grace window), publishes each via AmqpConnection.publish,
 * then markPublished. Multiple replicas can tick concurrently without
 * double-publishing the same row during a normal publish.
 *
 * Failure mode: if publish throws, claimed_at stays set; the row is
 * excluded from re-claim until the lease expires (CLAIM_GRACE_MS),
 * then the next tick retries. The `attempts` counter bumps each claim
 * — ops can alert on "rows stuck >N attempts". Downstream consumers
 * are idempotent, so a worker crash during publish at worst yields
 * one duplicate broker publish after the lease expires.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly amqp: AmqpConnection,
    private readonly runs: PipelineRunService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  public async tick(): Promise<void> {
    const rows = await this.outbox.claimPending(
      this.config.outboxPublisherBatchSize,
    );
    if (rows.length === 0) return;
    const publishTimeoutMs = this.config.pipelinePublishTimeoutMs;
    for (const row of rows) {
      try {
        const msg = row.message;
        if (
          msg.batchSeq != null &&
          msg.batchSeq > 0 &&
          (await this.runs.isBatchCompleted(
            row.pipelineRunId,
            msg.step,
            msg.batchSeq,
          ))
        ) {
          await this.outbox.markPublished(row.id);
          continue;
        }
        await this.amqp.publish(EXCHANGE_NAME, row.routingKey, row.message, {
          persistent: true,
          timeout: publishTimeoutMs,
        } as Options.Publish & { timeout: number });
        await this.outbox.markPublished(row.id);
      } catch (err) {
        this.logger.error(
          `outbox publish failed for id=${row.id} (attempt ${row.attempts}): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    this.logger.debug(`outbox tick: ${rows.length} messages drained`);
  }
}
