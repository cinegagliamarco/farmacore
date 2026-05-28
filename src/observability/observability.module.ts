import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '../config/config.module';
import { QueueMetricsPoller } from './queue-metrics.poller';

/**
 * Side-effect module: wires the QueueMetricsPoller cron. The OTel SDK
 * itself starts in `main.*.ts` (via startOtel) before Nest boots.
 */
@Module({
  imports: [ScheduleModule.forRoot(), AppConfigModule],
  providers: [QueueMetricsPoller],
})
export class ObservabilityModule {}
