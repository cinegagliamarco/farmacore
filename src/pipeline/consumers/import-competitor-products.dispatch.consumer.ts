import { Inject, Injectable } from '@nestjs/common';
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
import { TenantCompetitorOriginEntity } from '../../database/entities/core/tenant-competitor-origin.entity';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';
import { chunkSizeForOrigin } from '../import-batch-size';

const DISPATCH_QUEUE = dispatchStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS);

export interface ImportCompetitorProductsBatchPayload {
  origin: CompetitorOrigin;
  eans: string[];
}

/**
 * Dispatcher for per-origin product scrape. Reads enabled origins
 * from tenant_competitor_origin (only origins the tenant has opted
 * into get scraped), reads the EAN universe from product, and
 * for each enabled origin × EAN slice publishes one batch message
 * to that origin's queue.
 *
 * All per-origin batches share ONE dispatch row's fan-in counter.
 * Stock + image are scraped inline per product (see the step), so this
 * step owns the competitor-stock join branch: when the fan-in closes —
 * or here, when there's no work — it marks 'stock-b' and lets CALC fire
 * once 'stock-a' (ERP stock) is also done.
 */
@Injectable()
export class ImportCompetitorProductsDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_PRODUCTS;

  @Inject(PipelineJoinService)
  private readonly join!: PipelineJoinService;

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
    const enabledOrigins = await this.findEnabledOrigins(ctx);
    if (enabledOrigins.length === 0) {
      return { batches: [], emptySuccessors: await this.markStockB(ctx) };
    }
    const eans = await new ProductRepository(ctx.em).findAllEans();
    if (eans.length === 0) {
      return { batches: [], emptySuccessors: await this.markStockB(ctx) };
    }

    const batches: PipelineMessage<ImportCompetitorProductsBatchPayload>[] = [];
    let seq = 1;
    for (const origin of enabledOrigins) {
      const batchSize = chunkSizeForOrigin(
        origin,
        this.config.importVtexEanBatchSize,
        this.config.importNonVtexEanBatchSize,
      );
      const queue = originStep(PipelineStep.IMPORT_COMPETITOR_PRODUCTS, origin);
      for (let i = 0; i < eans.length; i += batchSize) {
        batches.push(
          newPipelineMessage<ImportCompetitorProductsBatchPayload>({
            pipelineRunId: ctx.message.pipelineRunId,
            tenantId: ctx.message.tenantId,
            step: PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
            queue,
            batchSeq: seq++,
            payload: { origin, eans: eans.slice(i, i + batchSize) },
          }),
        );
      }
    }

    this.logger.log(
      `import-competitor-products dispatch: ${batches.length} message(s) (${eans.length} EANs × ${enabledOrigins.length} origins, vtexBatch=${this.config.importVtexEanBatchSize})`,
    );
    return { batches };
  }

  /** No work to do → close the competitor-stock branch directly so CALC
   *  can fire once the ERP-stock branch (stock-a) is also complete. */
  private async markStockB(
    ctx: DispatchHandleContext,
  ): Promise<PipelineMessage<unknown>[]> {
    const outcome = await this.join.markBranchComplete(
      ctx.message.pipelineRunId,
      ctx.message.tenantId,
      'stock-b',
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

  private async findEnabledOrigins(
    ctx: DispatchHandleContext,
  ): Promise<CompetitorOrigin[]> {
    const rows = await ctx.em
      .getRepository(TenantCompetitorOriginEntity)
      .find({ where: { tenantId: ctx.tenant.id, enabled: true } });
    return rows.map((r) => r.origin);
  }
}
