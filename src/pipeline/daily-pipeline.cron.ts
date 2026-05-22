import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';

@Injectable()
export class DailyPipelineCron {
  private readonly logger = new Logger(DailyPipelineCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly publisher: PipelinePublisher,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      if (t.slug === 'system') continue;
      const runId = await this.publisher.publishStart(t.slug, { reason: 'cron' });
      this.logger.log(`Published pipeline.start for ${t.slug} run=${runId}`);
    }
  }
}
