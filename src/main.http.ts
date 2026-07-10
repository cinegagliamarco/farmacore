import { startOtel, shutdownOtel } from './observability/otel-bootstrap';
startOtel();

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { catchUnhandledSignals } from './common';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  catchUnhandledSignals(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port}`);
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
