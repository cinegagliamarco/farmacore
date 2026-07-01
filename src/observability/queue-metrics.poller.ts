import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { metrics } from '@opentelemetry/api';
import { AppConfigService } from '../config/app-config.service';

const meter = metrics.getMeter('farmacore.queue');
const depthGauge = meter.createObservableGauge('pipeline.queue.depth', {
  description: 'Number of messages in the queue',
});
const ageGauge = meter.createObservableGauge(
  'pipeline.queue.oldest_age_seconds',
  { description: 'Age of the oldest message in seconds' },
);

interface QueueInfo {
  name: string;
  messages: number;
  head_message_timestamp?: number | null;
}

/**
 * Polls the RabbitMQ management API every 30s and exposes per-queue
 * depth + oldest-message age as OTel observable gauges. No-op when
 * AMQP_MGMT_URL / USER / PASS (or legacy CLOUDAMQP_API_*) aren't all
 * set (dev default). Works against the same management API path on
 * Fly broker, CloudAMQP, and local `rabbitmq:management` on :15673.
 */
@Injectable()
export class QueueMetricsPoller {
  private readonly logger = new Logger(QueueMetricsPoller.name);
  private last: ReadonlyArray<QueueInfo> = [];

  constructor(private readonly config: AppConfigService) {
    depthGauge.addCallback((observer) => {
      for (const q of this.last) {
        observer.observe(q.messages, { queue: q.name });
      }
    });
    ageGauge.addCallback((observer) => {
      const nowSec = Math.floor(Date.now() / 1000);
      for (const q of this.last) {
        if (q.head_message_timestamp) {
          observer.observe(Math.max(0, nowSec - q.head_message_timestamp), {
            queue: q.name,
          });
        }
      }
    });
  }

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
      this.last = (await res.json()) as QueueInfo[];
    } catch (err) {
      this.logger.warn(`Queue metrics poll failed: ${(err as Error).message}`);
    }
  }
}
