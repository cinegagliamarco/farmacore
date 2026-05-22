import { INestApplicationContext, Logger } from '@nestjs/common';

export function catchUnhandledSignals(_app: INestApplicationContext): void {
  const logger = new Logger('GlobalExceptionSignalsHandler');
  process.on('uncaughtException', (err: Error) => {
    logger.error(`Received uncaughtException ${err.message}`, err.stack);
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error(`Received unhandledRejection ${err.message}`, err.stack);
  });
}
