import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import {
  DLX_NAME,
  EXCHANGE_NAME,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
} from './constants';
import { PipelineMessage } from './types';

export function delayQueueName(queueName: string, delayMs: number): string {
  return `${EXCHANGE_NAME}.retry.${queueName}.${delayMs}`;
}

@Injectable()
export class RetryService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async republishOnFailure<P>(
    msg: PipelineMessage<P>,
  ): Promise<'retried' | 'dlq'> {
    const routingSegment = msg.queue ?? msg.step;
    const nextAttempt = msg.attempt + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
      await this.amqp.publish(
        DLX_NAME,
        `${msg.tenantId}.${routingSegment}`,
        msg,
        { persistent: true },
      );
      return 'dlq';
    }
    const delay = RETRY_DELAYS_MS[msg.attempt - 1];
    await this.amqp.publish(
      '',
      delayQueueName(routingSegment, delay),
      { ...msg, attempt: nextAttempt },
      { persistent: true },
    );
    return 'retried';
  }
}
