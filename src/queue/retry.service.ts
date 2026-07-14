import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DLX_NAME } from './constants';
import { PipelineMessage } from './types';

/** Duplicate delivery that must bypass the generic failure path. This covers
 *  both a failed explicit republish and a step-level execution lock held by
 *  the original worker. Rethrowing lets golevelup nack/dead-letter through the
 *  queue DLX without `runs.fail()` clobbering the original RUNNING row. */
export class DuplicateDeliveryRepublishError extends Error {}

/**
 * Failed-message router. No retries: a step that throws is dead-lettered
 * on the first failure straight to the DLX, which fans it into the
 * matching `<queue>.dlq` mirror for inspect/replay via the admin API.
 * (Class name kept to avoid churn across every consumer — it no longer
 * retries; rename to DeadLetterService is a safe follow-up.)
 */
@Injectable()
export class RetryService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async republishOnFailure<P>(msg: PipelineMessage<P>): Promise<'dlq'> {
    const routingSegment = msg.queue ?? msg.step;
    await this.amqp.publish(
      DLX_NAME,
      `${msg.tenantId}.${routingSegment}`,
      msg,
      {
        persistent: true,
      },
    );
    return 'dlq';
  }
}
