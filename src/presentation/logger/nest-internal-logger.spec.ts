import { Logger } from '@nestjs/common';
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
    expect(underlying.warn).toHaveBeenCalledWith({ code: 'X', detail: 1 }, undefined);
  });
});
