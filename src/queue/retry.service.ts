import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DLX_NAME } from './constants';
import { PipelineMessage } from './types';

/** Thrown when the in-progress duplicate-delivery republish itself fails.
 *  The consumers' generic catch must RETHROW it (golevelup nacks and the
 *  broker dead-letters via the queue's DLX) instead of running its
 *  republish + runs.fail() path — fail() would clobber the original
 *  delivery's RUNNING row and stall the run. */
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
