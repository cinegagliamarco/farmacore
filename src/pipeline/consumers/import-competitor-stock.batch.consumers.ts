import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
  LastBatchContext,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, dispatchStep, originStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ImportCompetitorStockStep } from '../steps/import-competitor-stock.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';
import type { ImportCompetitorStockBatchPayload } from './import-competitor-stock.dispatch.consumer';

const QUEUE_DROGAL = originStep(
  PipelineStep.IMPORT_COMPETITOR_STOCK,
  CompetitorOrigin.DROGAL,
);
const QUEUE_DROGASIL = originStep(
  PipelineStep.IMPORT_COMPETITOR_STOCK,
  CompetitorOrigin.DROGASIL,
);

/**
 * Per-origin stock batch consumers. Same fan-in counter pattern as
 * import-competitor-products: all per-origin batches share one
 * dispatch row. On the LAST batch (from any origin),
 * PipelineJoinService.markBranchComplete fires for 'stock-b' — and
 * publishes CALC_BASE_PRODUCT_METRICS only when 'stock-a' is also
 * complete (legacy two-branch join, owned by Phase D to refactor).
 */
abstract class CompetitorStockBatchBase extends BatchPipelineConsumer<ImportCompetitorStockBatchPayload> {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_STOCK;

  protected constructor(
    private readonly stepImpl: ImportCompetitorStockStep,
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

  protected handle(
    ctx: BatchHandleContext<ImportCompetitorStockBatchPayload>,
  ): Promise<void> {
    return this.stepImpl.run(
      ctx.em,
      ctx.message.payload.origin,
      ctx.message.payload.items,
    );
  }

  protected async successors(
    ctx: LastBatchContext<ImportCompetitorStockBatchPayload>,
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

@Injectable()
export class ImportCompetitorStockDrogalConsumer extends CompetitorStockBatchBase {
  constructor(
    stepImpl: ImportCompetitorStockStep,
    join: PipelineJoinService,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(stepImpl, join, runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_DROGAL}`,
    createQueueIfNotExists: false,
    queue: QUEUE_DROGAL,
    queueOptions: { channel: QUEUE_DROGAL },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorStockBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorStockDrogasilConsumer extends CompetitorStockBatchBase {
  constructor(
    stepImpl: ImportCompetitorStockStep,
    join: PipelineJoinService,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(stepImpl, join, runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_DROGASIL}`,
    createQueueIfNotExists: false,
    queue: QUEUE_DROGASIL,
    queueOptions: { channel: QUEUE_DROGASIL },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorStockBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}
