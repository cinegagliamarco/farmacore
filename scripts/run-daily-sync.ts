import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DailyPipelineCron } from '../src/pipeline/daily-pipeline.cron';

// Fire the daily sync on demand — same code path as the midnight cron:
// publishes pipeline.start for every active tenant (skipping `system`).
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(DailyPipelineCron).fire();
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
