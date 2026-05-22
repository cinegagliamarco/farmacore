import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerModule } from './worker.module';
import { catchUnhandledSignals } from './common';

async function bootstrap(): Promise<void> {
  const isWorker = process.env.WORKER_MODE === '1';
  const logger = new Logger('Bootstrap');

  if (isWorker) {
    const app = await NestFactory.createApplicationContext(WorkerModule);
    catchUnhandledSignals(app);
    logger.log('Worker started — RMQ topology declared');
    const shutdown = (): void => {
      void app.close().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const app = await NestFactory.create(AppModule);
  catchUnhandledSignals(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
