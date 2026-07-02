import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { OutboxMetricsPoller } from './outbox-metrics.poller';
import { PipelineMetricsRegistry } from './pipeline-metrics.registry';
import { PipelineRunMetricsPoller } from './pipeline-run-metrics.poller';
import { PrometheusMetricsService } from './prometheus-metrics.service';
import { QueueMetricsPoller } from './queue-metrics.poller';

/**
 * Prometheus metrics (:9091/metrics) + pipeline/queue pollers.
 * OTLP SDK still starts in main.*.ts for traces only.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot(), AppConfigModule, DatabaseModule],
  providers: [
    PrometheusMetricsService,
    PipelineMetricsRegistry,
    QueueMetricsPoller,
    PipelineRunMetricsPoller,
    OutboxMetricsPoller,
  ],
  exports: [PipelineMetricsRegistry, PrometheusMetricsService],
})
export class ObservabilityModule {}
