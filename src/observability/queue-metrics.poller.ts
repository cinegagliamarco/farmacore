import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import {
  PipelineMetricsRegistry,
  type RmqQueueSnapshot,
} from './pipeline-metrics.registry';

/**
 * Polls the RabbitMQ management API every 30s and exposes per-queue depth,
 * age, rates and consumer counts as Prometheus gauges.
 */
@Injectable()
export class QueueMetricsPoller {
  private readonly logger = new Logger(QueueMetricsPoller.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  @Interval(30_000)
  public async poll(): Promise<void> {
    const { apiUrl, user, pass } = this.config.amqpMgmt;
    if (!apiUrl || !user || !pass) return;

    try {
      const auth = Buffer.from(`${user}:${pass}`).toString('base64');
      const res = await fetch(`${apiUrl}/queues`, {
        headers: { authorization: `Basic ${auth}` },
      });
      if (!res.ok) {
        this.logger.warn(
          `RabbitMQ management API ${res.status}: ${await res.text()}`,
        );
        return;
      }
      const queues = (await res.json()) as RmqQueueSnapshot[];
      this.metrics.updateRmqQueues(queues);
    } catch (err) {
      this.logger.warn(`Queue metrics poll failed: ${(err as Error).message}`);
    }
  }
}
