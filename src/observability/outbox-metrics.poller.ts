import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PipelineMetricsRegistry } from './pipeline-metrics.registry';
import { queryRows } from './sql-query.util';

type OutboxMetricsRow = {
  pending: string;
  max_attempts: string;
  oldest_pending_age_seconds: string;
};

const OUTBOX_QUERY = `
SELECT
  count(*) FILTER (WHERE published_at IS NULL) AS pending,
  coalesce(max(attempts) FILTER (WHERE published_at IS NULL), 0) AS max_attempts,
  coalesce(
    extract(epoch FROM (now() - min(created_at) FILTER (WHERE published_at IS NULL))),
    0
  ) AS oldest_pending_age_seconds
FROM core.pipeline_outbox
`;

/** Read-only poller: pending outbox rows → Prometheus gauges. */
@Injectable()
export class OutboxMetricsPoller {
  private readonly logger = new Logger(OutboxMetricsPoller.name);

  constructor(
    private readonly ds: DataSource,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  @Interval(30_000)
  public async poll(): Promise<void> {
    try {
      const rows = await queryRows<OutboxMetricsRow>(this.ds, OUTBOX_QUERY);
      const row = rows[0];
      if (!row) return;
      this.metrics.updateOutboxMetrics({
        pending: Number(row.pending),
        max_attempts: Number(row.max_attempts),
        oldest_pending_age_seconds: Number(row.oldest_pending_age_seconds),
      });
    } catch (err) {
      this.logger.warn(`Outbox metrics poll failed: ${(err as Error).message}`);
    }
  }
}
