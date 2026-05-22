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
import { UpdateBaseProductPropertiesStep } from '../steps/update-base-product-properties.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

@Injectable()
export class UpdateBaseProductPropertiesConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES;

  constructor(
    private readonly stepImpl: UpdateBaseProductPropertiesStep,
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
    routingKey: `*.${PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES}`,
    queue: PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
    queueOptions: {
      channel: 'update-base-product-properties',
      prefetchCount: STEP_PREFETCH[PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES],
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
          step: PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT,
          payload: {},
        }),
      ],
    };
  }
}
