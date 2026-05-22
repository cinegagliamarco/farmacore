import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  DLX_NAME,
  EXCHANGE_NAME,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from './constants';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export function delayQueueName(step: PipelineStep, delayMs: number): string {
  return `${EXCHANGE_NAME}.retry.${step}.${delayMs}`;
}

@Injectable()
export class RetryService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async republishOnFailure<P>(
    msg: PipelineMessage<P>,
  ): Promise<'retried' | 'dlq'> {
    const nextAttempt = msg.attempt + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
      await this.amqp.publish(DLX_NAME, `${msg.tenantId}.${msg.step}`, msg, {
        persistent: true,
      });
      return 'dlq';
    }
    const delay = RETRY_DELAYS_MS[msg.attempt - 1];
    const queue = delayQueueName(msg.step, delay);
    await this.amqp.publish(
      '',
      queue,
      { ...msg, attempt: nextAttempt },
      { persistent: true },
    );
    return 'retried';
  }
}
