import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  BasePipelineConsumer,
  HandleContext,
  HandleResult,
} from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ImportCompetitorStockStep } from '../steps/import-competitor-stock.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';

@Injectable()
export class ImportCompetitorStockConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.IMPORT_COMPETITOR_STOCK;

  constructor(
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

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.IMPORT_COMPETITOR_STOCK}`,
    createQueueIfNotExists: false,
    queue: PipelineStep.IMPORT_COMPETITOR_STOCK,
    queueOptions: {
      channel: 'import-competitor-stock',
    },
  })
  public consume(message: PipelineMessage): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);
    const branchOutcome = await this.join.markBranchComplete(
      ctx.message.pipelineRunId,
      ctx.message.tenantId,
      'stock-b',
    );
    if (branchOutcome === 'wait') return { successors: [] };
    return {
      successors: [
        newPipelineMessage({
          pipelineRunId: ctx.message.pipelineRunId,
          tenantId: ctx.message.tenantId,
          step: PipelineStep.CALC_BASE_PRODUCT_METRICS,
          queue: dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS),
          payload: {},
        }),
      ],
    };
  }
}
