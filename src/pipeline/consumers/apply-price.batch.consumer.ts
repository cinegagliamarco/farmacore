import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
  LastBatchContext,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep } from '../../queue/constants';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ApplyPriceStep } from '../steps/apply-price.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';

const BATCH_QUEUE = batchStep(PipelineStep.APPLY_PRICE);

/**
 * Batch do apply em massa: aplica os itens de (run, batchSeq) ao ERP. Step
 * folha do grafo — `successors()` (chamado só no último batch) fecha o run em
 * `done` e não encadeia nada.
 */
@Injectable()
export class ApplyPriceBatchConsumer extends BatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.APPLY_PRICE;

  constructor(
    private readonly stepImpl: ApplyPriceStep,
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
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: BatchHandleContext): Promise<void> {
    await this.stepImpl.run(
      ctx.em,
      ctx.message.tenantId,
      ctx.message.pipelineRunId,
      ctx.batchSeq,
    );
  }

  protected async successors(
    ctx: LastBatchContext,
  ): Promise<PipelineMessage<unknown>[]> {
    await ctx.em.query(
      `UPDATE pricing_apply_run SET status='done', updated_at=now() WHERE id=$1`,
      [ctx.message.pipelineRunId],
    );
    return [];
  }
}
