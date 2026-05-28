import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { execSync } from 'node:child_process';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { EXCHANGE_NAME } from '../src/queue/constants';

async function main(): Promise<void> {
  // Runtime-aware: prod runs compiled JS (ts-node pruned in the image),
  // dev runs .ts via ts-node through the npm script.
  const cmd = __dirname.includes('/dist/')
    ? 'node dist/scripts/migrate-app.js'
    : 'npm run migration:run:app';
  execSync(cmd, { stdio: 'inherit' });

  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource);
  const amqp = app.get(AmqpConnection);

  const tenants: Array<{ slug: string }> = await ds.query(
    `SELECT slug FROM core.tenant WHERE status = 'active' AND slug <> 'system' ORDER BY slug`,
  );

  for (const t of tenants) {
    await amqp.publish(
      EXCHANGE_NAME,
      `${t.slug}.migrate-tenant`,
      { tenantSlug: t.slug, publishedAt: new Date().toISOString() },
      { persistent: true },
    );
  }

  console.log(`Enqueued ${tenants.length} tenant migration(s).`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
