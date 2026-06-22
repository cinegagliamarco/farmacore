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

  // wait:false connects in the background, so poll briefly before
  // publishing. A broker outage must NOT block the deploy: app
  // migrations already ran above, and tenant enqueues are idempotent and
  // re-driven by the next deploy — so warn and skip rather than failing
  // (or hanging on a buffered publish) when RMQ is down.
  if (await waitForAmqp(amqp, 10_000)) {
    for (const t of tenants) {
      await amqp.publish(
        EXCHANGE_NAME,
        `${t.slug}.migrate-tenant`,
        { tenantSlug: t.slug, publishedAt: new Date().toISOString() },
        { persistent: true },
      );
    }
    console.log(`Enqueued ${tenants.length} tenant migration(s).`);
  } else {
    console.warn(
      `RabbitMQ unreachable — skipped enqueuing ${tenants.length} tenant migration(s); next deploy re-drives them.`,
    );
  }

  await app.close();
}

async function waitForAmqp(
  amqp: AmqpConnection,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!amqp.connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return amqp.connected;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
