import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import {
  EXCHANGE_NAME,
  PIPELINE_START_QUEUE,
  dispatchStep,
} from '../../queue/constants';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { newPipelineMessage } from '../../queue/types';
import type { PipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

@Injectable()
export class PipelineStartConsumer {
  private readonly logger = new Logger(PipelineStartConsumer.name);

  constructor(private readonly publisher: PipelinePublisher) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: '*.pipeline.start',
    createQueueIfNotExists: false,
    queue: PIPELINE_START_QUEUE,
  })
  public async handle(message: PipelineMessage): Promise<void> {
    this.logger.log(
      `pipeline.start for tenant=${message.tenantId} run=${message.pipelineRunId}`,
    );
    await this.publisher.publishStep(
      newPipelineMessage({
        pipelineRunId: message.pipelineRunId,
        tenantId: message.tenantId,
        step: PipelineStep.SYNC_BASE_PRODUCT,
        queue: dispatchStep(PipelineStep.SYNC_BASE_PRODUCT),
        payload: {},
      }),
    );
    await this.publisher.publishStep(
      newPipelineMessage({
        pipelineRunId: message.pipelineRunId,
        tenantId: message.tenantId,
        step: PipelineStep.SYNC_OFFER_BOOKS_INFO,
        payload: {},
      }),
    );
  }
}
