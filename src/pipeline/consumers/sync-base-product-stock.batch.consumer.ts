import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
  LastBatchContext,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep, dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncBaseProductStockStep } from '../steps/sync-base-product-stock.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';
import type { SyncBaseProductStockBatchPayload } from './sync-base-product-stock.dispatch.consumer';

const BATCH_QUEUE = batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK);

/**
 * Batch consumer for sync-base-product-stock. Runs the per-batch import,
 * then on the LAST batch consults PipelineJoinService.markBranchComplete
 * for the 'stock-a' branch. CALC_BASE_PRODUCT_METRICS is published only
 * when BOTH stock branches (stock-a here + stock-b from
 * import-competitor-stock) have closed. The first branch to close
 * returns [], the second one publishes CALC.
 *
 * The v1 PipelineJoinService is preserved through Phase B; replacement
 * with a counter-based fan-in lives in Phase D.
 */
@Injectable()
export class SyncBaseProductStockBatchConsumer extends BatchPipelineConsumer<SyncBaseProductStockBatchPayload> {
  protected readonly logicalStep = PipelineStep.SYNC_BASE_PRODUCT_STOCK;

  constructor(
    private readonly stepImpl: SyncBaseProductStockStep,
    private readonly join: PipelineJoinService,
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
    message: PipelineMessage<SyncBaseProductStockBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: BatchHandleContext<SyncBaseProductStockBatchPayload>,
  ): Promise<void> {
    await this.stepImpl.run(
      ctx.em,
      ctx.integrationDs,
      ctx.message.payload.embalagemIds,
    );
  }

  protected async successors(
    ctx: LastBatchContext<SyncBaseProductStockBatchPayload>,
  ): Promise<PipelineMessage<unknown>[]> {
    const outcome = await this.join.markBranchComplete(
      ctx.message.pipelineRunId,
      ctx.message.tenantId,
      'stock-a',
    );
    if (outcome === 'wait') return [];
    return [
      newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.CALC_BASE_PRODUCT_METRICS,
        queue: dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS),
        payload: {},
      }),
    ];
  }
}
