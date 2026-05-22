import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

export function catchUnhandledSignals(app: INestApplication | INestApplicationContext): void {
  const logger = app.get<InternalLogger>(INTERNAL_LOGGER_TOKEN);
  process.on('uncaughtException', (err: Error) => {
    logger.error(`Received uncaughtException ${err.message}`, 'GlobalExceptionSignalsHandler');
  });
  process.on('unhandledRejection', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Received unhandledRejection ${message}`, 'GlobalExceptionSignalsHandler');
  });
}
