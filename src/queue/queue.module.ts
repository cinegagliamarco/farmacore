import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import {
  DLX_NAME,
  EXCHANGE_NAME,
  MIGRATE_TENANT_QUEUE,
  PIPELINE_START_QUEUE,
  RETRY_DELAYS_MS,
  STEP_QUEUES,
} from './constants';
import { delayQueueName } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([PipelineRunEntity]),
    RabbitMQModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.amqpUrl,
        connectionInitOptions: { wait: true, timeout: 10_000 },
        exchanges: [
          { name: EXCHANGE_NAME, type: 'topic', options: { durable: true } },
          { name: DLX_NAME, type: 'topic', options: { durable: true } },
        ],
        queues: [
          ...STEP_QUEUES.flatMap((step) => [
            {
              name: step,
              exchange: EXCHANGE_NAME,
              routingKey: `*.${step}`,
              createQueueIfNotExists: true,
              options: {
                durable: true,
                arguments: {
                  'x-dead-letter-exchange': DLX_NAME,
                  'x-dead-letter-routing-key': step,
                },
              },
            },
            {
              name: `${step}.dlq`,
              exchange: DLX_NAME,
              routingKey: `*.${step}`,
              createQueueIfNotExists: true,
              options: { durable: true },
            },
            ...RETRY_DELAYS_MS.map((ms) => ({
              name: delayQueueName(step, ms),
              exchange: '',
              routingKey: delayQueueName(step, ms),
              createQueueIfNotExists: true,
              options: {
                durable: true,
                arguments: {
                  'x-message-ttl': ms,
                  'x-dead-letter-exchange': EXCHANGE_NAME,
                  'x-dead-letter-routing-key': `retry.${step}`,
                },
              },
            })),
          ]),
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
