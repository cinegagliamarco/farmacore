import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { PipelineMetricsRegistry } from './pipeline-metrics.registry';
import { queryRows } from './sql-query.util';

type PipelineRunRow = {
  tenant_id: string;
  step: string;
  status: string;
  batches_planned: number | null;
  batches_done: number | null;
  started_ts: string | null;
  finished_ts: string | null;
  duration_seconds: string | null;
};

const PIPELINE_RUN_QUERY = `
SELECT DISTINCT ON (tenant_id, step)
  tenant_id,
  step,
  status,
  batches_planned,
  batches_done,
  extract(epoch FROM started_at)  AS started_ts,
  extract(epoch FROM finished_at) AS finished_ts,
  CASE
    WHEN finished_at IS NOT NULL AND started_at IS NOT NULL
    THEN extract(epoch FROM (finished_at - started_at))
    ELSE NULL
  END AS duration_seconds
FROM core.pipeline_run
WHERE batch_seq = 0
ORDER BY tenant_id, step, started_at DESC
`;

/** Read-only poller: last dispatch row per tenant/step → Prometheus gauges. */
@Injectable()
export class PipelineRunMetricsPoller {
  private readonly logger = new Logger(PipelineRunMetricsPoller.name);

  constructor(
    private readonly ds: DataSource,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  @Interval(60_000)
  public async poll(): Promise<void> {
    try {
      const rows = await queryRows<PipelineRunRow>(this.ds, PIPELINE_RUN_QUERY);
      this.metrics.updatePipelineRuns(
        rows.map((r) => ({
          tenant_id: r.tenant_id,
          step: r.step,
          status: r.status,
          batches_planned: r.batches_planned,
          batches_done: r.batches_done,
          started_ts: r.started_ts != null ? Number(r.started_ts) : null,
          finished_ts: r.finished_ts != null ? Number(r.finished_ts) : null,
          duration_seconds:
            r.duration_seconds != null ? Number(r.duration_seconds) : null,
        })),
      );
    } catch (err) {
      this.logger.warn(
        `Pipeline run metrics poll failed: ${(err as Error).message}`,
      );
    }
  }
}
