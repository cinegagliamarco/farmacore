import { Inject, Injectable } from '@nestjs/common';
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
import { ImportCompetitorProductsStep } from '../steps/import-competitor-products.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelineJoinService } from '../pipeline-join.service';
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
const QUEUE_PAGUE_MENOS = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.PAGUE_MENOS,
);
const QUEUE_IKESAKI = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.IKESAKI,
);
const QUEUE_PACHECO = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.PACHECO,
);
const QUEUE_SAO_PAULO = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.SAO_PAULO,
);
const QUEUE_VENANCIO = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.VENANCIO,
);
const QUEUE_INDIANA = originStep(
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  CompetitorOrigin.INDIANA,
);

/**
 * One thin per-origin batch consumer per scrape queue. They all share
 * the same logicalStep (IMPORT_COMPETITOR_PRODUCTS) so the fan-in
 * counter on the dispatch row spans every origin — the last batch from
 * ANY origin closes the run.
 *
 * One separate class per origin (instead of one with many decorators)
 * because @RabbitSubscribe binds to a single queue per method.
 */
abstract class CompetitorProductsBatchBase extends BatchPipelineConsumer<ImportCompetitorProductsBatchPayload> {
  protected readonly logicalStep = PipelineStep.IMPORT_COMPETITOR_PRODUCTS;

  // Property injection (like the base's OutboxRepository) so the 5
  // per-origin subclasses don't thread it through their super() calls.
  @Inject(PipelineJoinService)
  protected readonly join!: PipelineJoinService;

  protected constructor(
    private readonly stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(runs, retry, tx, tenants, integration);
  }

  protected handle(
    ctx: BatchHandleContext<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.stepImpl.run(
      ctx.em,
      ctx.message.tenantId,
      ctx.message.payload.origin,
      ctx.message.payload.eans,
    );
  }

  /** Stock + image are scraped inline per product (see the step), so
   *  when the products fan-in closes this branch IS the competitor-stock
   *  branch: mark stock-b and fire CALC once stock-a (ERP stock) is also
   *  done. */
  protected async successors(
    ctx: LastBatchContext<ImportCompetitorProductsBatchPayload>,
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
export class ImportCompetitorProductsDrogalConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
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
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
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
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
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

@Injectable()
export class ImportCompetitorProductsPagueMenosConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_PAGUE_MENOS}`,
    createQueueIfNotExists: false,
    queue: QUEUE_PAGUE_MENOS,
    queueOptions: { channel: QUEUE_PAGUE_MENOS },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsIkesakiConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_IKESAKI}`,
    createQueueIfNotExists: false,
    queue: QUEUE_IKESAKI,
    queueOptions: { channel: QUEUE_IKESAKI },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsPachecoConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_PACHECO}`,
    createQueueIfNotExists: false,
    queue: QUEUE_PACHECO,
    queueOptions: { channel: QUEUE_PACHECO },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsSaoPauloConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_SAO_PAULO}`,
    createQueueIfNotExists: false,
    queue: QUEUE_SAO_PAULO,
    queueOptions: { channel: QUEUE_SAO_PAULO },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsVenancioConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_VENANCIO}`,
    createQueueIfNotExists: false,
    queue: QUEUE_VENANCIO,
    queueOptions: { channel: QUEUE_VENANCIO },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}

@Injectable()
export class ImportCompetitorProductsIndianaConsumer extends CompetitorProductsBatchBase {
  constructor(
    stepImpl: ImportCompetitorProductsStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
  ) {
    super(stepImpl, runs, retry, tx, tenants, integration);
  }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${QUEUE_INDIANA}`,
    createQueueIfNotExists: false,
    queue: QUEUE_INDIANA,
    queueOptions: { channel: QUEUE_INDIANA },
  })
  public consume(
    message: PipelineMessage<ImportCompetitorProductsBatchPayload>,
  ): Promise<void> {
    return this.process(message);
  }
}
