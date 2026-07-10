import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PipelinePublisher } from '../src/queue/pipeline-publisher.service';

async function main(): Promise<void> {
  const slug = process.argv[2] ?? 'acme';
  const app = await NestFactory.createApplicationContext(AppModule);
  const runId = await app
    .get(PipelinePublisher)
    .publishStart(slug, { reason: 'manual' });
  console.log('runId =', runId);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
