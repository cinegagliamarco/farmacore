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
import { CalcBaseProductMetricsStep } from '../steps/calc-base-product-metrics.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import type { CalcBaseProductMetricsBatchPayload } from './calc-base-product-metrics.dispatch.consumer';

const BATCH_QUEUE = batchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS);

@Injectable()
export class CalcBaseProductMetricsBatchConsumer extends BatchPipelineConsumer<CalcBaseProductMetricsBatchPayload> {
  protected readonly logicalStep = PipelineStep.CALC_BASE_PRODUCT_METRICS;

  constructor(
    private readonly stepImpl: CalcBaseProductMetricsStep,
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
    message: PipelineMessage<CalcBaseProductMetricsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }

  protected handle(
    ctx: BatchHandleContext<CalcBaseProductMetricsBatchPayload>,
  ): Promise<void> {
    return this.stepImpl.run(ctx.em, ctx.tenant.id, ctx.message.payload.eans);
  }

  protected successors(
    ctx: LastBatchContext<CalcBaseProductMetricsBatchPayload>,
  ): Promise<PipelineMessage<unknown>[]> {
    return Promise.resolve([
      newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
        queue: dispatchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES),
        payload: {},
      }),
    ]);
  }
}
