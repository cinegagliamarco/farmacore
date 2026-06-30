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
import { SyncStoresStep } from '../steps/sync-stores.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

@Injectable()
export class SyncStoresConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.SYNC_STORES;

  constructor(
    private readonly stepImpl: SyncStoresStep,
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
    routingKey: `*.${PipelineStep.SYNC_STORES}`,
    createQueueIfNotExists: false,
    queue: PipelineStep.SYNC_STORES,
    queueOptions: { channel: 'sync-stores' },
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
          step: PipelineStep.SYNC_PRODUCT_ITEMS,
          queue: dispatchStep(PipelineStep.SYNC_PRODUCT_ITEMS),
          payload: {},
        }),
      ],
    };
  }
}
