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
import { ProductRepository } from '../../database/repositories/tenant/product.repository';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const BATCH_SIZE = 500;
const DISPATCH_QUEUE = dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS);
const BATCH_QUEUE = batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS);

export interface CalcBaseProductMetricsBatchPayload {
  eans: string[];
}

/**
 * Dispatcher for calc-base-product-metrics. Enumerates all EANs in
 * product, chunks into 500-EAN slices, emits one batch per
 * slice. Each row is independent (no cross-EAN contention) so chunking
 * by ean directly is safe.
 *
 * emptySuccessors falls through to UPDATE_BASE_PRODUCT_PROPERTIES so
 * the chain advances even when the tenant has no products.
 */
@Injectable()
export class CalcBaseProductMetricsDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.CALC_BASE_PRODUCT_METRICS;

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
      step: PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
      queue: dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES),
      payload: {},
    });

    const eans = await new ProductRepository(ctx.em).findAllEans();
    if (eans.length === 0) {
      return { batches: [], emptySuccessors: [successor] };
    }

    const batches: PipelineMessage<CalcBaseProductMetricsBatchPayload>[] = [];
    for (
      let offset = 0, seq = 1;
      offset < eans.length;
      offset += BATCH_SIZE, seq++
    ) {
      batches.push(
        newPipelineMessage<CalcBaseProductMetricsBatchPayload>({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.CALC_BASE_PRODUCT_METRICS,
          queue: BATCH_QUEUE,
          batchSeq: seq,
          payload: { eans: eans.slice(offset, offset + BATCH_SIZE) },
        }),
      );
    }

    this.logger.log(
      `calc-base-product-metrics dispatch: ${eans.length} EANs -> ${batches.length} batch(es) of <= ${BATCH_SIZE}`,
    );
    return { batches, emptySuccessors: [successor] };
  }
}
