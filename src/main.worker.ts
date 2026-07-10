process.env.WORKER_MODE = '1';

import { startOtel, shutdownOtel } from './observability/otel-bootstrap';
startOtel();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { catchUnhandledSignals } from './common';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule);
  catchUnhandledSignals(app);
  logger.log('Worker started — connecting to RMQ in background');
  const shutdown = (): void => {
    void app
      .close()
      .then(shutdownOtel)
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error(err);
        process.exit(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
