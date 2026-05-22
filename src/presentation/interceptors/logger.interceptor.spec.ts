import { ExecutionContext, HttpException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { LoggerInterceptor } from './logger.interceptor';
import { InternalLogger } from '../../interfaces';

function fakeHttpContext(req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

describe('LoggerInterceptor', () => {
  let logger: jest.Mocked<InternalLogger>;
  let interceptor: LoggerInterceptor;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    interceptor = new LoggerInterceptor(logger);
  });

  it('logs successful HTTP request with duration + status_code', async () => {
    const ctx = fakeHttpContext({
      method: 'GET',
      route: { path: '/things' },
      params: {},
      body: { password: 'secret', name: 'ok' },
      query: {},
      ip: '::ffff:127.0.0.1',
      header: () => 'x',
    });
    await firstValueFrom(
      interceptor.intercept(ctx, { handle: () => of(undefined) }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/things',
        method: 'GET',
        status_code: 200,
        body: { password: '**********', name: 'ok' },
        ip: '127.0.0.1',
        duration: expect.any(Number),
      }),
      interceptor,
    );
  });

  it('skips logging /health', async () => {
    const ctx = fakeHttpContext({
      method: 'GET',
      route: { path: '/health' },
      params: {},
      body: {},
      query: {},
      ip: '127.0.0.1',
      header: () => 'x',
    });
    await firstValueFrom(
      interceptor.intercept(ctx, { handle: () => of(undefined) }),
    );
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('records error status from HttpException', async () => {
    const ctx = fakeHttpContext({
      method: 'POST',
      route: { path: '/things' },
      params: {},
      body: {},
      query: {},
      ip: '127.0.0.1',
      header: () => 'x',
    });
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx, {
          handle: () => throwError(() => new HttpException('nope', 418)),
        }),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({ status_code: 418, error_message: 'nope' }),
      interceptor,
    );
  });
});
