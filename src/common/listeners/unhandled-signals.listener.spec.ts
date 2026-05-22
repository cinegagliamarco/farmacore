import { INestApplication } from '@nestjs/common';
import { catchUnhandledSignals } from './unhandled-signals.listener';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

describe('catchUnhandledSignals', () => {
  let app: { get: jest.Mock };
  let logger: jest.Mocked<InternalLogger>;
  const originalListeners = {
    uncaughtException: process.listeners('uncaughtException').slice(),
    unhandledRejection: process.listeners('unhandledRejection').slice(),
  };

  beforeEach(() => {
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    app = { get: jest.fn().mockReturnValue(logger) };
  });

  afterEach(() => {
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    for (const l of originalListeners.uncaughtException) process.on('uncaughtException', l);
    for (const l of originalListeners.unhandledRejection) process.on('unhandledRejection', l);
  });

  it('resolves logger via INTERNAL_LOGGER_TOKEN', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    expect(app.get).toHaveBeenCalledWith(INTERNAL_LOGGER_TOKEN);
  });

  it('logs uncaughtException', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit('uncaughtException', new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('uncaughtException'),
      'GlobalExceptionSignalsHandler',
    );
  });

  it('logs unhandledRejection', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit('unhandledRejection', new Error('nope') as never, Promise.resolve() as never);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('unhandledRejection'),
      'GlobalExceptionSignalsHandler',
    );
  });
});
