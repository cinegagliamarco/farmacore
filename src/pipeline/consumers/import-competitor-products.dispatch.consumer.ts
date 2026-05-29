import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import { EXCHANGE_NAME, dispatchStep, originStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ProductRepository } from '../../database/repositories/tenant/product.repository';
import { TenantCompetitorOriginEntity } from '../../database/entities/tenant/tenant-competitor-origin.entity';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

const DISPATCH_QUEUE = dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS);

export interface ImportCompetitorProductsBatchPayload {
  origin: CompetitorOrigin;
  eans: string[];
}

/**
 * Dispatcher for per-origin product scrape. Reads enabled origins
 * from tenant_competitor_origin (only origins the tenant has opted
 * into get scraped), reads the EAN universe from product, and
 * for each enabled origin × every PER_ORIGIN_BATCH_SIZE-EAN slice
 * publishes one batch message to that origin's queue.
 *
 * All per-origin batches share ONE dispatch row's fan-in counter.
 * The last batch from any origin to land closes the counter and
 * publishes the IMPORT_COMPETITOR_STOCK successor (still v1 today;
 * routes through the legacy step queue).
 *
 * emptySuccessors falls through to IMPORT_COMPETITOR_STOCK when the
 * tenant has no enabled origins or no EANs — chain advances either way.
 */
@Injectable()
export class ImportCompetitorProductsDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_PRODUCTS;

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
      step: PipelineStep.IMPORT_COMPETITOR_STOCK,
      queue: dispatchStep(PipelineStep.IMPORT_COMPETITOR_STOCK),
      payload: {},
    });

    const enabledOrigins = await this.findEnabledOrigins(ctx);
    if (enabledOrigins.length === 0) {
      return { batches: [], emptySuccessors: [successor] };
    }
    const eans = await new ProductRepository(ctx.em).findAllEans();
    if (eans.length === 0) {
      return { batches: [], emptySuccessors: [successor] };
    }

    // One message per EAN per origin — prefetch on each per-origin queue
    // is the rate limit (see STEP_PREFETCH). Mirrors legacy's per-origin
    // parallelism without an in-process batch loop.
    const batches: PipelineMessage<ImportCompetitorProductsBatchPayload>[] = [];
    let seq = 1;
    for (const origin of enabledOrigins) {
      const queue = originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, origin);
      for (const ean of eans) {
        batches.push(
          newPipelineMessage<ImportCompetitorProductsBatchPayload>({
            pipelineRunId: ctx.message.pipelineRunId,
            tenantId: ctx.message.tenantId,
            step: PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
            queue,
            batchSeq: seq++,
            payload: { origin, eans: [ean] },
          }),
        );
      }
    }

    this.logger.log(
      `import-competitor-products dispatch: ${batches.length} message(s) (1/EAN) across ${enabledOrigins.length} origins`,
    );
    return { batches, emptySuccessors: [successor] };
  }

  private async findEnabledOrigins(
    ctx: DispatchHandleContext,
  ): Promise<CompetitorOrigin[]> {
    const rows = await ctx.em
      .getRepository(TenantCompetitorOriginEntity)
      .find({ where: { enabled: true } });
    return rows.map((r) => r.origin);
  }
}
