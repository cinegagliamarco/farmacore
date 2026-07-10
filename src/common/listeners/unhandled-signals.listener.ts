import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { INTERNAL_LOGGER_TOKEN, InternalLogger } from '../../interfaces';

export function catchUnhandledSignals(
  app: INestApplication | INestApplicationContext,
): void {
  const logger = app.get<InternalLogger>(INTERNAL_LOGGER_TOKEN);
  // Node deems resuming after these unsafe — log and die; Fly restarts us.
  process.on('uncaughtException', (err: Error) => {
    logger.error(
      `Received uncaughtException ${err.stack ?? err.message}`,
      'GlobalExceptionSignalsHandler',
    );
    process.exit(1);
  });
  process.on('unhandledRejection', (err: unknown) => {
    const message =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.error(
      `Received unhandledRejection ${message}`,
      'GlobalExceptionSignalsHandler',
    );
    process.exit(1);
  });
}
