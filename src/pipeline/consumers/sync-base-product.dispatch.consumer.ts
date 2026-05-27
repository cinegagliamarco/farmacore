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
import {
  A7PharmaRepositories,
  chunkEmbalagensByEan,
} from '../../integration/repositories/a7pharma';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const BATCH_SIZE = 500;
const DISPATCH_QUEUE = dispatchStep(PipelineStep.SYNC_BASE_PRODUCT);
const BATCH_QUEUE = batchStep(PipelineStep.SYNC_BASE_PRODUCT);

export interface SyncBaseProductBatchPayload {
  embalagemIds: number[];
}

/**
 * Dispatcher for sync-base-product: scans valid embalagem rows in the
 * tenant's ERP, chunks the IDs into BATCH_SIZE slices, and publishes
 * one batch message per chunk. The successor (sync-base-product-stock)
 * is published as emptySuccessors when there is nothing to do; in the
 * normal case the LAST batch closes the fan-in counter and publishes
 * the successor itself.
 *
 * Note: legacy synchronize-base-product called offer_book.deleteAll()
 * here. We don't, on purpose — with dispatcher restart + per-batch
 * idempotency, a deleteAll() would erase rows the previously-completed
 * batches inserted. Stale offer_book rows (for eans that disappear
 * from the ERP) are tolerated for v2; a follow-up cleanup pass can
 * reconcile based on the EAN universe of a run.
 */
@Injectable()
export class SyncBaseProductDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.SYNC_BASE_PRODUCT;

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
    queueOptions: { channel: DISPATCH_QUEUE },
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(
    ctx: DispatchHandleContext,
  ): Promise<DispatchHandleResult> {
    const successor = newPipelineMessage({
      pipelineRunId: ctx.message.pipelineRunId,
      tenantId: ctx.message.tenantId,
      step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
      queue: dispatchStep(PipelineStep.SYNC_BASE_PRODUCT_STOCK),
      payload: {},
    });

    if (!ctx.integrationDs) {
      this.logger.warn(
        `No integration DataSource for tenant ${ctx.message.tenantId}; emitting empty successor only`,
      );
      return { batches: [], emptySuccessors: [successor] };
    }

    const a7 = new A7PharmaRepositories(ctx.integrationDs);
    const slices = await chunkEmbalagensByEan(a7.embalagem, BATCH_SIZE);
    if (slices.length === 0) {
      return { batches: [], emptySuccessors: [successor] };
    }

    const batches = slices.map((slice, i) =>
      newPipelineMessage<SyncBaseProductBatchPayload>({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.SYNC_BASE_PRODUCT,
        queue: BATCH_QUEUE,
        batchSeq: i + 1,
        payload: { embalagemIds: slice.embalagemIds },
      }),
    );

    this.logger.log(
      `sync-base-product dispatch: ${batches.length} batch(es) of <= ${BATCH_SIZE} EANs`,
    );
    return { batches, emptySuccessors: [successor] };
  }
}
