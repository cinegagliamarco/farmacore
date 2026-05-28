import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import {
  EXCHANGE_NAME,
  PER_ORIGIN_STOCK_BATCH_SIZE,
  dispatchStep,
  originStep,
} from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SharedProductRepository } from '../../database/repositories/shared-catalog/product.repository';
import { TenantCompetitorOriginEntity } from '../../database/entities/tenant/tenant-competitor-origin.entity';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';

const DISPATCH_QUEUE = dispatchStep(PipelineStep.IMPORT_COMPETITOR_STOCK);
const STOCK_ORIGINS: ReadonlyArray<CompetitorOrigin> = [
  CompetitorOrigin.DROGAL,
  CompetitorOrigin.DROGASIL,
];

export interface ImportCompetitorStockBatchPayload {
  origin: CompetitorOrigin;
  items: Array<{ ean: string; sku: string }>;
}

/**
 * Dispatcher for per-origin stock scrape. Reads enabled origins from
 * tenant_competitor_origin (intersected with the origins that have a
 * stock scraper: Drogal + Drogasil), pulls (ean, sku) candidates from
 * shared_catalog.product for each enabled origin, chunks per origin
 * using PER_ORIGIN_STOCK_BATCH_SIZE (Drogal=50, Drogasil=30).
 *
 * All batches share one dispatch row's fan-in counter. The last
 * batch from any origin calls PipelineJoinService.markBranchComplete
 * for 'stock-b'; if 'stock-a' (from sync-base-product-stock) is
 * already complete, CALC fires; otherwise we wait.
 *
 * Empty-data path marks the branch directly so the sibling stock-a
 * isn't stuck waiting.
 */
@Injectable()
export class ImportCompetitorStockDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_STOCK;

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
    const enabledRows = await ctx.em
      .getRepository(TenantCompetitorOriginEntity)
      .find({ where: { enabled: true } });
    const enabledOrigins = enabledRows
      .map((r) => r.origin)
      .filter((o): o is CompetitorOrigin => STOCK_ORIGINS.includes(o));

    if (enabledOrigins.length === 0) {
      return {
        batches: [],
        emptySuccessors: await this.markBranchAndSuccessor(ctx),
      };
    }

    const productRepo = new SharedProductRepository(ctx.em);
    const batches: PipelineMessage<ImportCompetitorStockBatchPayload>[] = [];
    let seq = 1;
    for (const origin of enabledOrigins) {
      const candidates = await productRepo.findStockCandidatesByOrigin(origin);
      const size = PER_ORIGIN_STOCK_BATCH_SIZE[origin] ?? 50;
      const queue = originStep(PipelineStep.IMPORT_COMPETITOR_STOCK, origin);
      for (let offset = 0; offset < candidates.length; offset += size) {
        batches.push(
          newPipelineMessage<ImportCompetitorStockBatchPayload>({
            pipelineRunId: ctx.message.pipelineRunId,
            tenantId: ctx.message.tenantId,
            step: PipelineStep.IMPORT_COMPETITOR_STOCK,
            queue,
            batchSeq: seq++,
            payload: {
              origin,
              items: candidates.slice(offset, offset + size),
            },
          }),
        );
      }
    }

    if (batches.length === 0) {
      return {
        batches: [],
        emptySuccessors: await this.markBranchAndSuccessor(ctx),
      };
    }

    this.logger.log(
      `import-competitor-stock dispatch: ${batches.length} batch(es) across ${enabledOrigins.length} origins`,
    );
    return { batches };
  }

  /**
   * Same join handling as sync-base-product-stock empty path: when
   * there's nothing to scrape we still must close stock-b so CALC
   * can eventually fire.
   */
  private async markBranchAndSuccessor(
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
}
