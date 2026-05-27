import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import {
  EXCHANGE_NAME,
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
import { PipelineJoinService } from '../pipeline-join.service';

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
 * v1 PipelineJoinService — when batches are emitted, the batch
 * consumer's successors() owns the join; when there are no batches,
 * the dispatcher marks 'stock-a' directly so the sibling branch isn't
 * stuck waiting forever.
 */
@Injectable()
export class SyncBaseProductStockDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.SYNC_BASE_PRODUCT_STOCK;

  constructor(
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
    routingKey: `*.${DISPATCH_QUEUE}`,
    createQueueIfNotExists: false,
    queue: DISPATCH_QUEUE,
    queueOptions: { channel: DISPATCH_QUEUE },
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: DispatchHandleContext,
  ): Promise<DispatchHandleResult> {
    const ids = ctx.integrationDs
      ? await new A7PharmaRepositories(ctx.integrationDs).embalagem.findAllValidIds()
      : [];

    if (ids.length === 0) {
      if (!ctx.integrationDs) {
        this.logger.warn(
          `No integration DataSource for tenant ${ctx.message.tenantId}; marking stock-a branch complete`,
        );
      }
      return { batches: [], emptySuccessors: await this.markBranchAndSuccessor(ctx) };
    }

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

  /**
   * Empty-batches path: nobody will ever call BatchConsumer.successors(),
   * so the dispatcher itself must close the 'stock-a' join branch and
   * decide whether CALC fires now (sibling already done) or waits.
   */
  private async markBranchAndSuccessor(
    ctx: DispatchHandleContext,
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
        payload: {},
      }),
    ];
  }
}
