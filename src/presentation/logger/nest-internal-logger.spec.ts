import { Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { NestInternalLogger } from './nest-internal-logger';

describe('NestInternalLogger', () => {
  let underlying: jest.Mocked<Logger>;
  let log: NestInternalLogger;

  beforeEach(() => {
    underlying = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;
    log = new NestInternalLogger(underlying);
  });

  it('forwards .log(payload) with no context', () => {
    log.log({ hello: 'world' });
    expect(underlying.log).toHaveBeenCalledWith({ hello: 'world' }, undefined);
  });

  it('extracts class name when context is an instance', () => {
    class MyService {}
    log.log('hi', new MyService());
    expect(underlying.log).toHaveBeenCalledWith('hi', 'MyService');
  });

  it('passes string contexts through', () => {
    log.error('boom', 'CustomContext');
    expect(underlying.error).toHaveBeenCalledWith('boom', 'CustomContext');
  });

  it('serializes object payloads to JSON for non-string error messages', () => {
    log.warn({ code: 'X', detail: 1 });
    expect(underlying.warn).toHaveBeenCalledWith(
      { code: 'X', detail: 1 },
      undefined,
    );
  });

  it('stamps traceId/spanId on object payloads when a span is active', () => {
    const fakeSpan = {
      spanContext: () => ({ traceId: 'abc', spanId: 'def' }),
    } as never;
    const spy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(fakeSpan);
    log.log({ event: 'hello' });
    expect(underlying.log).toHaveBeenCalledWith(
      { event: 'hello', traceId: 'abc', spanId: 'def' },
      undefined,
    );
    spy.mockRestore();
  });

  it('leaves string payloads untouched (no IDs to stamp on)', () => {
    const fakeSpan = {
      spanContext: () => ({ traceId: 'abc', spanId: 'def' }),
    } as never;
    const spy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(fakeSpan);
    log.log('plain string');
    expect(underlying.log).toHaveBeenCalledWith('plain string', undefined);
    spy.mockRestore();
  });
});
