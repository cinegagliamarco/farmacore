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
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const BATCH_SIZE = 50;
const DISPATCH_QUEUE = dispatchStep(PipelineStep.APPLY_PRICE);
const BATCH_QUEUE = batchStep(PipelineStep.APPLY_PRICE);

/**
 * Dispatcher do apply em massa: lê os itens `pending` do run (id =
 * pipelineRunId), fatia em batches de BATCH_SIZE, grava o `batch_seq` em cada
 * item (commitado pela tx do tenant antes dos batches serem publicados) e emite
 * um batch por fatia. Run sem itens → marca `done` e não emite nada (folha).
 */
@Injectable()
export class ApplyPriceDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.APPLY_PRICE;

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
    const runId = ctx.message.pipelineRunId;
    const items: Array<{ id: string }> = await ctx.em.query(
      `SELECT id FROM pricing_apply_item
        WHERE apply_run_id = $1 AND status = 'pending'
        ORDER BY id`,
      [runId],
    );
    if (items.length === 0) {
      await ctx.em.query(
        `UPDATE pricing_apply_run SET status='done', updated_at=now() WHERE id=$1`,
        [runId],
      );
      return { batches: [] };
    }

    await ctx.em.query(
      `UPDATE pricing_apply_run SET status='running', updated_at=now() WHERE id=$1`,
      [runId],
    );
    const batches: PipelineMessage<unknown>[] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const seq = batches.length + 1;
      const ids = items.slice(i, i + BATCH_SIZE).map((r) => r.id);
      await ctx.em.query(
        `UPDATE pricing_apply_item SET batch_seq=$2, updated_at=now()
          WHERE id = ANY($1::uuid[])`,
        [ids, seq],
      );
      batches.push(
        newPipelineMessage({
          pipelineRunId: runId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.APPLY_PRICE,
          queue: BATCH_QUEUE,
          batchSeq: seq,
          payload: {},
        }),
      );
    }
    this.logger.log(
      `apply-price dispatch: ${batches.length} batch(es) for run ${runId}`,
    );
    return { batches };
  }
}
