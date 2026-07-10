import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';

@Injectable()
export class DailyPipelineCron {
  private readonly logger = new Logger(DailyPipelineCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly publisher: PipelinePublisher,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    const tenants = await this.tenants.listActive();
    let published = 0;
    for (const t of tenants) {
      if (t.slug === 'system') continue;
      // Per-tenant catch: one failed publish must not cost the remaining
      // tenants their daily run.
      try {
        const runId = await this.publisher.publishStart(
          t.slug,
          { reason: 'cron' },
          { producer: 'cron:daily-pipeline' },
        );
        published++;
        this.logger.log(`Published pipeline.start for ${t.slug} run=${runId}`);
      } catch (err) {
        this.logger.error(
          `pipeline.start publish failed for ${t.slug}: ${(err as Error).message}`,
        );
      }
    }
    // Only when something actually went out — recording on a 0-publish
    // tick would mask a full AMQP outage on the dashboard.
    if (published > 0) this.metrics.recordDailyPipelinePublished();
  }
}
