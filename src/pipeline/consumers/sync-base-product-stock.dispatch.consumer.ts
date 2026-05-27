import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import {
  EXCHANGE_NAME,
  STEP_PREFETCH,
  batchStep,
  dispatchStep,
} from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { A7PharmaRepositories } from '../../integration/repositories/a7pharma';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const BATCH_SIZE = 500;
const DISPATCH_QUEUE = dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK);
const BATCH_QUEUE = batchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK);

export interface SyncBaseProductStockBatchPayload {
  embalagemIds: number[];
}

/**
 * Dispatcher for sync-base-product-stock: scans the same valid embalagem
 * universe as sync-base-product and emits one batch per BATCH_SIZE-slice
 * of IDs. The successor (calc-base-product-metrics) is gated by the
 * v1 PipelineJoinService — the batch consumer's successors() decides
 * whether to publish CALC or just mark this branch complete.
 *
 * emptySuccessors is omitted on purpose: if there's nothing to do for
 * this step, the join should still wait for the sibling branch
 * (import-competitor-stock) before CALC fires. We mark the branch via
 * an empty-data path inside the batch consumer when needed.
 */
@Injectable()
export class SyncBaseProductStockDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.SYNC_BASE_PRODUCT_STOCK;

  constructor(
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
    routingKey: `*.${DISPATCH_QUEUE}`,
    createQueueIfNotExists: false,
    queue: DISPATCH_QUEUE,
    queueOptions: {
      channel: DISPATCH_QUEUE,
    },
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: DispatchHandleContext,
  ): Promise<DispatchHandleResult> {
    if (!ctx.integrationDs) {
      this.logger.warn(
        `No integration DataSource for tenant ${ctx.message.tenantId}; emitting no batches`,
      );
      return { batches: [] };
    }
    const a7 = new A7PharmaRepositories(ctx.integrationDs);
    const ids = await a7.embalagem.findAllValidIds();
    if (ids.length === 0) return { batches: [] };

    const batches: PipelineMessage<SyncBaseProductStockBatchPayload>[] = [];
    for (let offset = 0, seq = 1; offset < ids.length; offset += BATCH_SIZE, seq++) {
      batches.push(
        newPipelineMessage<SyncBaseProductStockBatchPayload>({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
          queue: BATCH_QUEUE,
          batchSeq: seq,
          payload: { embalagemIds: ids.slice(offset, offset + BATCH_SIZE) },
        }),
      );
    }

    this.logger.log(
      `sync-base-product-stock dispatch: ${ids.length} embalagens -> ${batches.length} batch(es) of <= ${BATCH_SIZE}`,
    );
    return { batches };
  }

  protected static readonly _prefetchAck = STEP_PREFETCH[DISPATCH_QUEUE];
}
