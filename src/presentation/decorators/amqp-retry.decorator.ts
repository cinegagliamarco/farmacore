import { SetMetadata } from '@nestjs/common';

export const AMQP_RETRY_TOKEN = 'AMQP_RETRY';

export const AmqpRetry = (maxRetries: number): MethodDecorator =>
  SetMetadata(AMQP_RETRY_TOKEN, maxRetries);
