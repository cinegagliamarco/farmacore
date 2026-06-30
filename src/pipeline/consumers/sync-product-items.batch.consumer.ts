import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep } from '../../queue/constants';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncProductItemsStep } from '../steps/sync-product-items.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import type { SyncProductItemsBatchPayload } from './sync-product-items.dispatch.consumer';

const BATCH_QUEUE = batchStep(PipelineStep.SYNC_PRODUCT_ITEMS);

/**
 * Batch consumer for sync-product-items. Each batch projects one slice of
 * products × the active stores into product_item, in its own tenant
 * transaction. Terminal step — the per-store data foundation ends here.
 */
@Injectable()
export class SyncProductItemsBatchConsumer extends BatchPipelineConsumer<SyncProductItemsBatchPayload> {
  protected readonly logicalStep = PipelineStep.SYNC_PRODUCT_ITEMS;

  constructor(
    private readonly stepImpl: SyncProductItemsStep,
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
    queueOptions: { channel: BATCH_QUEUE },
  })
  public consume(
    message: PipelineMessage<SyncProductItemsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: BatchHandleContext<SyncProductItemsBatchPayload>,
  ): Promise<void> {
    await this.stepImpl.run(
      ctx.em,
      ctx.integrationDs,
      ctx.message.payload.productIds,
      ctx.message.payload.stores,
    );
  }

  protected successors(): Promise<PipelineMessage<unknown>[]> {
    return Promise.resolve([]);
  }
}
