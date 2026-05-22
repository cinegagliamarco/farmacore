jest.mock('../../common/wait-for', () => ({
  waitFor: jest.fn().mockResolvedValue(undefined),
}));

import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AmqpInterceptor } from './amqp.interceptor';
import { InternalLogger } from '../../interfaces';

function fakeRmqContext(
  channel: { ack: jest.Mock; nack: jest.Mock; sendToQueue: jest.Mock },
  message: Record<string, unknown>,
): ExecutionContext {
  const rmq = { getChannelRef: () => channel, getMessage: () => message };
  return {
    getType: () => 'rmq',
    getArgByIndex: (i: number) => (i === 1 ? rmq : undefined),
    getArgs: () => [{}, { fields: { routingKey: 'rk' } }],
    getHandler: () => () => {},
  } as unknown as ExecutionContext;
}

describe('AmqpInterceptor', () => {
  let channel: { ack: jest.Mock; nack: jest.Mock; sendToQueue: jest.Mock };
  let reflector: Reflector;
  let logger: jest.Mocked<InternalLogger>;
  let interceptor: AmqpInterceptor;

  beforeEach(() => {
    channel = { ack: jest.fn(), nack: jest.fn(), sendToQueue: jest.fn() };
    reflector = new Reflector();
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    interceptor = new AmqpInterceptor(reflector, logger);
  });

  it('acks on success', async () => {
    const ctx = fakeRmqContext(channel, {
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
      content: Buffer.from('{}'),
    });
    await firstValueFrom(
      interceptor.intercept(ctx, { handle: () => of(undefined) }),
    );
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks (no requeue) on hard error', async () => {
    const ctx = fakeRmqContext(channel, {
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
      content: Buffer.from('{}'),
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('reenqueues with x-retry-count when @AmqpRetry(2) and ServiceUnavailableException, attempt 1', async () => {
    jest.spyOn(reflector, 'get').mockReturnValue(2);
    const ctx = fakeRmqContext(channel, {
      fields: { routingKey: 'rk' },
      properties: { headers: {} },
      content: Buffer.from('{}'),
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new ServiceUnavailableException()),
        }),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(channel.sendToQueue).toHaveBeenCalled();
    const [, , properties] = channel.sendToQueue.mock.calls[0];
    expect(properties.headers['x-retry-count']).toBe(1);
  });

  it('passes through HTTP requests untouched', async () => {
    const ctx = {
      getType: () => 'http',
      getArgByIndex: () => undefined,
    } as unknown as ExecutionContext;
    const result = await firstValueFrom(
      interceptor.intercept(ctx, { handle: () => of('ok') }),
    );
    expect(result).toBe('ok');
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
