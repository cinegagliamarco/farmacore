import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EXCHANGE_NAME } from './constants';
import { OutboxRepository } from './outbox.repository';

const BATCH_SIZE = 100;

/**
 * Drains the pipeline_outbox table on a tick. Claims rows via UPDATE
 * SKIP LOCKED so multiple worker replicas don't double-publish,
 * publishes each via AmqpConnection.publish, then markPublished.
 *
 * Failure mode: if publish throws, the row stays unpublished
 * (markPublished not called); next tick retries. The `attempts`
 * counter is bumped each claim — ops can build a "rows stuck >N
 * attempts" alert from it.
 *
 * Runs on every worker; the SKIP LOCKED makes that safe.
 */
@Injectable()
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly amqp: AmqpConnection,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  public async tick(): Promise<void> {
    const rows = await this.outbox.claimPending(BATCH_SIZE);
    if (rows.length === 0) return;
    for (const row of rows) {
      try {
        await this.amqp.publish(
          EXCHANGE_NAME,
          row.routingKey,
          row.message,
          { persistent: true },
        );
        await this.outbox.markPublished(row.id);
      } catch (err) {
        this.logger.error(
          `outbox publish failed for id=${row.id} (attempt ${row.attempts}): ${err instanceof Error ? err.message : err}`,
        );
        // Leave published_at NULL; next tick reclaims and retries.
      }
    }
    this.logger.debug(`outbox tick: ${rows.length} messages drained`);
  }
}
