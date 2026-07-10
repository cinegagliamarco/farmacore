import { INestApplication } from '@nestjs/common';
import { catchUnhandledSignals } from './unhandled-signals.listener';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

describe('catchUnhandledSignals', () => {
  let app: { get: jest.Mock };
  let logger: jest.Mocked<InternalLogger>;
  let exitSpy: jest.SpyInstance;
  const originalListeners = {
    uncaughtException: process.listeners('uncaughtException').slice(),
    unhandledRejection: process.listeners('unhandledRejection').slice(),
  };

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    app = { get: jest.fn().mockReturnValue(logger) };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    for (const l of originalListeners.uncaughtException)
      process.on('uncaughtException', l);
    for (const l of originalListeners.unhandledRejection)
      process.on('unhandledRejection', l);
  });

  it('resolves logger via INTERNAL_LOGGER_TOKEN', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    expect(app.get).toHaveBeenCalledWith(INTERNAL_LOGGER_TOKEN);
  });

  it('logs uncaughtException and exits 1', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit('uncaughtException', new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('uncaughtException'),
      'GlobalExceptionSignalsHandler',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs unhandledRejection and exits 1', () => {
    catchUnhandledSignals(app as unknown as INestApplication);
    process.emit(
      'unhandledRejection',
      new Error('nope') as never,
      Promise.resolve() as never,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('unhandledRejection'),
      'GlobalExceptionSignalsHandler',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
