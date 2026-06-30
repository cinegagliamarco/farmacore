import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep, dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { resolveTenantId } from '../../tenant/tenant-lookup';
import type { StoreRef } from '../steps/sync-product-items.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const BATCH_SIZE = 500;
const DISPATCH_QUEUE = dispatchStep(PipelineStep.SYNC_PRODUCT_ITEMS);
const BATCH_QUEUE = batchStep(PipelineStep.SYNC_PRODUCT_ITEMS);

export interface SyncProductItemsBatchPayload {
  productIds: string[];
  stores: StoreRef[];
}

/**
 * Dispatcher for sync-product-items: resolves the tenant's ACTIVE stores
 * (a snapshot passed to every batch so the whole run uses one store set),
 * then chunks the products that have an ERP embalagem id into BATCH_SIZE
 * slices. Terminal step: no batches and no stores ⇒ empty path that just
 * completes the run. The per-batch transaction (one chunk × the stores)
 * keeps the ERP round-trips off a single long-held transaction.
 */
@Injectable()
export class SyncProductItemsDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.SYNC_PRODUCT_ITEMS;

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
    const tenantId = await resolveTenantId(ctx.em, ctx.message.tenantId);
    const stores: StoreRef[] = await ctx.em.query(
      `SELECT id, external_id::text AS "externalId"
         FROM core.tenant_store
        WHERE tenant_id = $1 AND active = true AND deleted_at IS NULL`,
      [tenantId],
    );
    if (stores.length === 0) return { batches: [], emptySuccessors: [] };

    const products: Array<{ id: string }> = await ctx.em.query(
      `SELECT id FROM product
        WHERE external_id IS NOT NULL AND deleted_at IS NULL
        ORDER BY ean`,
    );
    if (products.length === 0) return { batches: [], emptySuccessors: [] };

    const batches: PipelineMessage<SyncProductItemsBatchPayload>[] = [];
    let seq = 1;
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      batches.push(
        newPipelineMessage<SyncProductItemsBatchPayload>({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.SYNC_PRODUCT_ITEMS,
          queue: BATCH_QUEUE,
          batchSeq: seq++,
          payload: {
            productIds: products.slice(i, i + BATCH_SIZE).map((p) => p.id),
            stores,
          },
        }),
      );
    }

    this.logger.log(
      `sync-product-items dispatch: ${batches.length} batch(es) × ${stores.length} active store(s)`,
    );
    return { batches };
  }
}
