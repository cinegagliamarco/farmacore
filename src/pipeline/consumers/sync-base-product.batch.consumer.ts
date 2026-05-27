import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchHandleResult,
  BatchPipelineConsumer,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH, batchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncBaseProductStep } from '../steps/sync-base-product.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import type { SyncBaseProductBatchPayload } from './sync-base-product.dispatch.consumer';

const BATCH_QUEUE = batchStep(PipelineStep.SYNC_BASE_PRODUCT);

@Injectable()
export class SyncBaseProductBatchConsumer extends BatchPipelineConsumer<SyncBaseProductBatchPayload> {
  protected readonly logicalStep = PipelineStep.SYNC_BASE_PRODUCT;

  constructor(
    private readonly stepImpl: SyncBaseProductStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${BATCH_QUEUE}`,
    createQueueIfNotExists: false,
    queue: BATCH_QUEUE,
    queueOptions: {
      channel: BATCH_QUEUE,
    },
  })
  public consume(
    message: PipelineMessage<SyncBaseProductBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: BatchHandleContext<SyncBaseProductBatchPayload>,
  ): Promise<BatchHandleResult> {
    await this.stepImpl.run(
      ctx.em,
      ctx.integrationDs,
      ctx.message.payload.embalagemIds,
    );
    return {
      successors: [
        newPipelineMessage({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
          payload: {},
        }),
      ],
    };
  }

  protected static readonly _prefetchAck = STEP_PREFETCH[BATCH_QUEUE];
}
