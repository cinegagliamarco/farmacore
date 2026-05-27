import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BatchHandleContext,
  BatchPipelineConsumer,
  LastBatchContext,
} from '../../queue/batch-pipeline.consumer';
import { EXCHANGE_NAME, originStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ImportCompetitorProductsStep } from '../steps/import-competitor-products.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import type { ImportCompetitorProductsBatchPayload } from './import-competitor-products.dispatch.consumer';

const QUEUE_DROGAL = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.DROGAL,
);
const QUEUE_DROGASIL = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.DROGASIL,
);
const QUEUE_MICHELASSI = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.MICHELASSI,
);

/**
 * One thin per-origin batch consumer per scrape queue. They all share
 * the same logicalStep (IMPORT_COMPETITOR_PRODUCTS) so the fan-in
 * counter on the dispatch row spans all three origins — the last
 * batch from ANY origin closes the run.
 *
 * Three separate classes (instead of one with three decorators)
 * because @RabbitSubscribe binds to a single queue per method.
 */
abstract class CompetitorProductsBatchBase extends BatchPipelineConsumer<ImportCompetitorProductsBatchPayload> {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_PRODUCTS;

  protected constructor(
    private readonly stepImpl: ImportCompetitorProductsStep,
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
    ctx: BatchHandleContext<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.stepImpl.run(
      ctx.em,
      ctx.message.payload.origin,
      ctx.message.payload.eans,
    );
  }

  protected successors(
    ctx: LastBatchContext<ImportCompetitorProductsBatchPayload>,
  ): Promise<PipelineMessage<unknown>[]> {
    return Promise.resolve([
      newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.IMPORT_COMPETITOR_STOCK,
        payload: {},
      }),
    ]);
  }
}

@Injectable()
export class ImportCompetitorProductsDrogalConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_DROGAL}`,
    createQueueIfNotExists: false,
    queue: QUEUE_DROGAL,
    queueOptions: { channel: QUEUE_DROGAL },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsDrogasilConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_DROGASIL}`,
    createQueueIfNotExists: false,
    queue: QUEUE_DROGASIL,
    queueOptions: { channel: QUEUE_DROGASIL },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsMichelassiConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration, publisher);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_MICHELASSI}`,
    createQueueIfNotExists: false,
    queue: QUEUE_MICHELASSI,
    queueOptions: { channel: QUEUE_MICHELASSI },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}
