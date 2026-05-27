import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { CompetitorOrigin } from '../database/enums/competitor-origin.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import {
  BATCHED_STEPS,
  DLX_NAME,
  EXCHANGE_NAME,
  MIGRATE_TENANT_QUEUE,
  PER_ORIGIN_STEPS,
  PIPELINE_START_QUEUE,
  RETRY_DELAYS_MS,
  STEP_PREFETCH,
  STEP_QUEUES,
  batchStep,
  dispatchStep,
  originStep,
} from './constants';
import { delayQueueName } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';

/**
 * Build the queue + DLQ + retry-delay declarations for one queue
 * name. Used for every kind of step (v1 single-queue, v2 batched
 * dispatch+batch, v2 per-origin). The shape is identical: main queue
 * with DLX wiring, a .dlq mirror under DLX, plus one delay queue
 * per RETRY_DELAYS_MS entry.
 */
const queueWithDlqAndRetries = (q: string) => [
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
  ...RETRY_DELAYS_MS.map((ms) => ({
    name: delayQueueName(q, ms),
    exchange: '',
    routingKey: delayQueueName(q, ms),
    createQueueIfNotExists: true,
    options: {
      durable: true,
      arguments: {
        'x-message-ttl': ms,
        'x-dead-letter-exchange': EXCHANGE_NAME,
        'x-dead-letter-routing-key': `retry.${q}`,
      },
    },
  })),
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
    TypeOrmModule.forFeature([PipelineRunEntity]),
    RabbitMQModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.amqpUrl,
        connectionInitOptions: { wait: true, timeout: 10_000 },
        channels: {
          ...Object.fromEntries(
            STEP_QUEUES.map((step) => [
              step,
              { prefetchCount: STEP_PREFETCH[step] },
            ]),
          ),
          ...Object.fromEntries(
            BATCHED_STEPS.flatMap((step) => [
              [dispatchStep(step), { prefetchCount: STEP_PREFETCH[dispatchStep(step)] }],
              [batchStep(step), { prefetchCount: STEP_PREFETCH[batchStep(step)] }],
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
          ...STEP_QUEUES.flatMap((step) => queueWithDlqAndRetries(step)),
          ...BATCHED_STEPS.flatMap((step) => [
            ...queueWithDlqAndRetries(dispatchStep(step)),
            ...queueWithDlqAndRetries(batchStep(step)),
          ]),
          ...perOriginQueueNames().flatMap(queueWithDlqAndRetries),
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
  providers: [PipelinePublisher, PipelineRunService, RetryService],
  exports: [
    PipelinePublisher,
    PipelineRunService,
    RetryService,
    RabbitMQModule,
  ],
})
export class QueueModule {}
