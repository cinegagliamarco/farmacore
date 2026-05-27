import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { EXCHANGE_NAME } from './constants';
import {
  PipelineMessage,
  PipelineStartPayload,
  newPipelineMessage,
} from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

@Injectable()
export class PipelinePublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  public async publishStart(
    tenantSlug: string,
    payload: PipelineStartPayload,
  ): Promise<string> {
    const pipelineRunId = randomUUID();
    const message: PipelineMessage<PipelineStartPayload> = newPipelineMessage({
      pipelineRunId,
      tenantId: tenantSlug,
      step: 'pipeline.start' as PipelineStep,
      payload,
    });
    await this.amqp.publish(
      EXCHANGE_NAME,
      `${tenantSlug}.pipeline.start`,
      message,
      {
        persistent: true,
      },
    );
    return pipelineRunId;
  }

  public async publishStep<P>(message: PipelineMessage<P>): Promise<void> {
    const routingSegment = message.queue ?? message.step;
    await this.amqp.publish(
      EXCHANGE_NAME,
      `${message.tenantId}.${routingSegment}`,
      message,
      {
        persistent: true,
      },
    );
  }
}
