import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import type { Options } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { EXCHANGE_NAME, STEP_QUEUES, dispatchStep } from './constants';
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

  /**
   * Trigger a single step in isolation (admin "run one routine"). New
   * run id, `standalone` set so the step doesn't chain its successors.
   * Routes to the step's entry queue: its `.dispatch` for batched /
   * per-origin steps, or the bare step queue for single-queue steps.
   */
  public async publishSingleStep(
    tenantSlug: string,
    step: PipelineStep,
  ): Promise<string> {
    const pipelineRunId = randomUUID();
    const queue = STEP_QUEUES.includes(step) ? step : dispatchStep(step);
    const message = newPipelineMessage({
      pipelineRunId,
      tenantId: tenantSlug,
      step,
      queue,
      payload: {},
      standalone: true,
    });
    await this.amqp.publish(EXCHANGE_NAME, `${tenantSlug}.${queue}`, message, {
      persistent: true,
    });
    return pipelineRunId;
  }

  public async publishStep<P>(
    message: PipelineMessage<P>,
    timeoutMs?: number,
  ): Promise<void> {
    const routingSegment = message.queue ?? message.step;
    await this.amqp.publish(
      EXCHANGE_NAME,
      `${message.tenantId}.${routingSegment}`,
      message,
      {
        persistent: true,
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      } as Options.Publish & { timeout?: number },
    );
  }
}
