import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BasePipelineConsumer,
  HandleContext,
  HandleResult,
} from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH } from '../../queue/constants';
import { PipelineMessage, newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ImportCompetitorProductsStep } from '../steps/import-competitor-products.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

@Injectable()
export class ImportCompetitorProductsConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.IMPORT_COMPETITOR_PRODUCTS;

  constructor(
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

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.IMPORT_COMPETITOR_PRODUCTS}`,
    queue: PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
    queueOptions: {
      channel: 'import-competitor-products',
      prefetchCount: STEP_PREFETCH[PipelineStep.IMPORT_COMPETITOR_PRODUCTS],
    },
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);
    return {
      successors: [
        newPipelineMessage({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.IMPORT_COMPETITOR_STOCK,
          payload: {},
        }),
      ],
    };
  }
}
