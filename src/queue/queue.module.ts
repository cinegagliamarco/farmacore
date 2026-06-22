import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import type { Options } from 'amqplib';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { PipelineOutboxEntity } from '../database/entities/core/pipeline-outbox.entity';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import {
  BATCHED_STEPS,
  DLX_NAME,
  EXCHANGE_NAME,
  MIGRATE_TENANT_QUEUE,
  PER_ORIGIN_STEPS,
  PIPELINE_START_QUEUE,
  STEP_PREFETCH,
  STEP_QUEUES,
  batchStep,
  dispatchStep,
  originStep,
} from './constants';
import { OutboxPublisher } from './outbox-publisher.service';
import { OutboxRepository } from './outbox.repository';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';

/**
 * Build the queue + DLQ declarations for one queue name. Used for every
 * kind of step (v1 single-queue, v2 batched dispatch+batch, v2
 * per-origin): the main queue with DLX wiring + a `.dlq` mirror under
 * the DLX. No retry/delay queues — a failed message dead-letters once.
 */
const queueWithDlq = (q: string) => [
  {
    name: q,
    exchange: EXCHANGE_NAME,
    routingKey: `*.${q}`,
    createQueueIfNotExists: true,
    options: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DLX_NAME,
        'x-dead-letter-routing-key': q,
      },
    },
  },
  {
    name: `${q}.dlq`,
    exchange: DLX_NAME,
    routingKey: `*.${q}`,
    createQueueIfNotExists: true,
    options: { durable: true },
  },
];

const perOriginQueueNames = (): string[] => {
  const out: string[] = [];
  for (const [stepKey, origins] of Object.entries(PER_ORIGIN_STEPS)) {
    const step = stepKey as PipelineStep;
    if (!origins) continue;
    out.push(dispatchStep(step));
    for (const origin of origins) out.push(originStep(step, origin));
  }
  return out;
};

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([PipelineRunEntity, PipelineOutboxEntity]),
    RabbitMQModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.amqpUrl,
        // wait:false — a broker outage must not crash boot. The HTTP API
        // stays up and the worker reconnects in the background;
        // amqp-connection-manager re-declares topology and re-attaches
        // consumers on reconnect.
        connectionInitOptions: { wait: false },
        // Without a timeout, publishes buffer forever while the broker is
        // down: admin routes that publish directly would hang and the
        // outbox/retry buffer would grow unbounded. This is a confirm
        // channel, so the timer also covers live pipeline publishes
        // awaiting their broker confirm — 30s is high enough that only a
        // real outage trips it, not normal confirm latency or a brief
        // reconnect (which would otherwise dead-letter in-flight steps).
        // golevelup types this as amqplib Options.Publish but honors
        // `timeout` underneath.
        defaultPublishOptions: { timeout: 30_000 } as Options.Publish & {
          timeout: number;
        },
        channels: {
          ...Object.fromEntries(
            STEP_QUEUES.map((step) => [
              step,
              { prefetchCount: STEP_PREFETCH[step] },
            ]),
          ),
          ...Object.fromEntries(
            BATCHED_STEPS.flatMap((step) => [
              [
                dispatchStep(step),
                { prefetchCount: STEP_PREFETCH[dispatchStep(step)] },
              ],
              [
                batchStep(step),
                { prefetchCount: STEP_PREFETCH[batchStep(step)] },
              ],
            ]),
          ),
          ...Object.fromEntries(
            perOriginQueueNames().map((q) => [
              q,
              { prefetchCount: STEP_PREFETCH[q] ?? 1 },
            ]),
          ),
          'migrate-tenant': { prefetchCount: 10 },
        },
        exchanges: [
          { name: EXCHANGE_NAME, type: 'topic', options: { durable: true } },
          { name: DLX_NAME, type: 'topic', options: { durable: true } },
        ],
        queues: [
          ...STEP_QUEUES.flatMap((step) => queueWithDlq(step)),
          ...BATCHED_STEPS.flatMap((step) => [
            ...queueWithDlq(dispatchStep(step)),
            ...queueWithDlq(batchStep(step)),
          ]),
          ...perOriginQueueNames().flatMap(queueWithDlq),
          {
            name: PIPELINE_START_QUEUE,
            exchange: EXCHANGE_NAME,
            routingKey: '*.pipeline.start',
            createQueueIfNotExists: true,
            options: { durable: true },
          },
          {
            name: MIGRATE_TENANT_QUEUE,
            exchange: EXCHANGE_NAME,
            routingKey: '*.migrate-tenant',
            createQueueIfNotExists: true,
            options: { durable: true },
          },
        ],
      }),
    }),
  ],
  providers: [
    PipelinePublisher,
    PipelineRunService,
    RetryService,
    OutboxRepository,
    OutboxPublisher,
  ],
  exports: [
    PipelinePublisher,
    PipelineRunService,
    RetryService,
    OutboxRepository,
    RabbitMQModule,
  ],
})
export class QueueModule {}
