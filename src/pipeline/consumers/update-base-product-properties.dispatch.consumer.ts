import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  DispatchHandleContext,
  DispatchHandleResult,
  DispatchPipelineConsumer,
} from '../../queue/dispatch-pipeline.consumer';
import { EXCHANGE_NAME, batchStep, dispatchStep } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { BaseProductRepository } from '../../database/repositories/shared-catalog/base-product.repository';
import { ProductRepository } from '../../database/repositories/tenant/product.repository';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import type { PropertiesPass } from '../steps/update-base-product-properties.step';

const BATCH_SIZE = 500;
const DISPATCH_QUEUE = dispatchStep(
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
);
const BATCH_QUEUE = batchStep(PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES);

export interface UpdateBaseProductPropertiesBatchPayload {
  pass: PropertiesPass;
  eans: string[];
}

/**
 * 4-pass dispatcher: queries the "candidate EANs" for each pass
 * (rows missing the target column), chunks per pass into 500-EAN
 * batches, emits all batches under one dispatch row. Terminal step:
 * the last batch closes the fan-in counter and the pipeline ends.
 */
@Injectable()
export class UpdateBaseProductPropertiesDispatchConsumer extends DispatchPipelineConsumer {
  protected readonly logicalStep = PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES;

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
    const productRepo = new ProductRepository(ctx.em);
    const baseProductRepo = new BaseProductRepository(ctx.em);

    const passCandidates: Array<{ pass: PropertiesPass; eans: string[] }> = [
      { pass: 'supplier', eans: await productRepo.findEansMissingSupplier() },
      { pass: 'name', eans: await productRepo.findEansMissingName() },
      { pass: 'weight', eans: await baseProductRepo.findEansMissingWeight() },
      {
        pass: 'measures',
        eans: await baseProductRepo.findEansMissingMeasures(),
      },
    ];

    const batches: PipelineMessage<UpdateBaseProductPropertiesBatchPayload>[] =
      [];
    let seq = 1;
    for (const { pass, eans } of passCandidates) {
      for (let offset = 0; offset < eans.length; offset += BATCH_SIZE) {
        batches.push(
          newPipelineMessage<UpdateBaseProductPropertiesBatchPayload>({
            pipelineRunId: ctx.message.pipelineRunId,
            tenantId: ctx.message.tenantId,
            step: PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
            queue: BATCH_QUEUE,
            batchSeq: seq++,
            payload: { pass, eans: eans.slice(offset, offset + BATCH_SIZE) },
          }),
        );
      }
    }

    if (batches.length === 0) return { batches: [] };

    this.logger.log(
      `update-base-product-properties dispatch: ${batches.length} batch(es) across 4 passes`,
    );
    return { batches };
  }
}
