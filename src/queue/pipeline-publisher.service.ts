import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { PipelineMetricsRegistry } from '../observability/pipeline-metrics.registry';
import { EXCHANGE_NAME, STEP_QUEUES, dispatchStep } from './constants';
import {
  PipelineMessage,
  PipelineStartPayload,
  newPipelineMessage,
} from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export interface PublishMeta {
  producer: string;
  count?: number;
}

@Injectable()
export class PipelinePublisher {
  constructor(
    private readonly amqp: AmqpConnection,
    private readonly metrics: PipelineMetricsRegistry,
  ) {}

  public async publishStart(
    tenantSlug: string,
    payload: PipelineStartPayload,
    meta?: PublishMeta,
  ): Promise<string> {
    const pipelineRunId = randomUUID();
    const message: PipelineMessage<PipelineStartPayload> = newPipelineMessage({
      pipelineRunId,
      tenantId: tenantSlug,
      step: 'pipeline.start' as PipelineStep,
      payload,
    });
    const targetQueue = `${tenantSlug}.pipeline.start`;
    await this.amqp.publish(EXCHANGE_NAME, targetQueue, message, {
      persistent: true,
    });
    this.metrics.onPublish(
      meta?.producer ?? 'unknown',
      tenantSlug,
      'pipeline.start',
      meta?.count ?? 1,
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
    meta?: PublishMeta,
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
    this.metrics.onPublish(
      meta?.producer ?? 'unknown',
      tenantSlug,
      queue,
      meta?.count ?? 1,
    );
    return pipelineRunId;
  }

  public async publishStep<P>(
    message: PipelineMessage<P>,
    timeoutMs?: number,
    meta?: PublishMeta,
  ): Promise<void> {
    const routingSegment = message.queue ?? message.step;
    await this.amqp.publish(
      EXCHANGE_NAME,
      `${message.tenantId}.${routingSegment}`,
      message,
      {
        persistent: true,
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      },
    );
    this.metrics.onPublish(
      meta?.producer ?? 'unknown',
      message.tenantId,
      routingSegment,
      meta?.count ?? 1,
    );
  }
}
