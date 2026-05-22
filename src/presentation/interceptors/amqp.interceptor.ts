import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, catchError, finalize, from, switchMap, throwError } from 'rxjs';
import type { ConfirmChannel, Message } from 'amqplib';
import { waitFor } from '../../common/wait-for';
import { INTERNAL_LOGGER_TOKEN } from '../../interfaces';
import type { InternalLogger } from '../../interfaces';
import { AMQP_RETRY_TOKEN } from '../decorators';

const REQUEUE_DELAY_MS = 30_000;

interface RmqContextLike {
  getChannelRef: () => ConfirmChannel;
  getMessage: () => Message;
}

@Injectable()
export class AmqpInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(INTERNAL_LOGGER_TOKEN) private readonly logger: InternalLogger,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<string>() === 'http') return next.handle();

    const rmqContext = context.getArgByIndex(1) as RmqContextLike | undefined;
    if (!rmqContext) return next.handle();

    const channel = rmqContext.getChannelRef();
    const originalMessage = rmqContext.getMessage();
    let failed = false;

    return next.handle().pipe(
      catchError((error: Error) => {
        failed = true;
        const maxRetries = this.reflector.get<number | undefined>(
          AMQP_RETRY_TOKEN,
          context.getHandler(),
        );
        if (this.shouldRequeue(originalMessage, error, maxRetries)) {
          return from(this.requeueMessage(maxRetries!, originalMessage, channel)).pipe(
            switchMap(() => throwError(() => error)),
          );
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (failed) {
          channel.nack(originalMessage, false, false);
          return;
        }
        channel.ack(originalMessage);
      }),
    );
  }

  private async requeueMessage(
    maxRetries: number,
    originalMessage: Message,
    channel: ConfirmChannel,
  ): Promise<void> {
    const nextRetry = this.currentRetry(originalMessage) + 1;
    const isLast = nextRetry === maxRetries;

    const content = JSON.parse(originalMessage.content.toString()) as Record<string, unknown>;
    const body = isLast ? { ...content, lastRetry: true } : content;
    const properties = {
      ...originalMessage.properties,
      headers: {
        ...(originalMessage.properties.headers ?? {}),
        'x-retry-count': nextRetry,
      },
    };

    this.logger.log(
      `Re-enqueueing ${originalMessage.fields.routingKey} (attempt ${nextRetry}/${maxRetries}, delay ${REQUEUE_DELAY_MS}ms)`,
      this,
    );

    await waitFor(REQUEUE_DELAY_MS);
    channel.sendToQueue(
      originalMessage.fields.routingKey,
      Buffer.from(JSON.stringify(body)),
      properties,
    );
  }

  private shouldRequeue(message: Message, error: Error, maxRetries?: number): boolean {
    if (!maxRetries || !(error instanceof ServiceUnavailableException)) return false;
    return this.currentRetry(message) < maxRetries;
  }

  private currentRetry(message: Message): number {
    const headers = (message.properties.headers ?? {}) as Record<string, unknown>;
    return Number(headers['x-retry-count'] ?? 0);
  }
}
