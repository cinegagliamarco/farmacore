import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
  LastBatchContext,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { UpdateBaseProductPropertiesStep } from '../steps/update-base-product-properties.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import type { UpdateBaseProductPropertiesBatchPayload } from './update-base-product-properties.dispatch.consumer';

const BATCH_QUEUE = batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES);

@Injectable()
export class UpdateBaseProductPropertiesBatchConsumer extends BatchPipelineConsumer<UpdateBaseProductPropertiesBatchPayload> {
  protected readonly logicalStep = PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES;

  constructor(
    private readonly stepImpl: UpdateBaseProductPropertiesStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${BATCH_QUEUE}`,
    createQueueIfNotExists: false,
    queue: BATCH_QUEUE,
    queueOptions: { channel: BATCH_QUEUE },
  })
  public consume(
    message: PipelineMessage<UpdateBaseProductPropertiesBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }

  protected handle(
    ctx: BatchHandleContext<UpdateBaseProductPropertiesBatchPayload>,
  ): Promise<void> {
    return this.stepImpl.run(
      ctx.em,
      ctx.message.payload.pass,
      ctx.message.payload.eans,
    );
  }

  protected successors(
    ctx: LastBatchContext<UpdateBaseProductPropertiesBatchPayload>,
  ): Promise<PipelineMessage<unknown>[]> {
    // Tail: products are fully synced, so kick off the per-store data
    // foundation (stores → product_item) as a linear sequence.
    return Promise.resolve([
      newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.SYNC_STORES,
        payload: {},
      }),
    ]);
  }
}
