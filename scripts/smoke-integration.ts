import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '../src/worker.module';
import { IntegrationConnectionService } from '../src/integration/integration-connection.service';
import { IntegrationDataSourceFactory } from '../src/integration/integration-data-source.factory';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const conn = app.get(IntegrationConnectionService);
  const factory = app.get(IntegrationDataSourceFactory);

  const slug = process.argv[2] ?? 'acme';
  const host = process.env.SMOKE_ERP_HOST ?? 'localhost';
  const port = Number(process.env.SMOKE_ERP_PORT ?? 5435);

  await conn.upsert(slug, {
    name: 'Local ERP',
    host,
    port,
    database: 'erp',
    username: 'erp',
    password: 'erp',
    sslMode: 'disable',
    readOnly: true,
  });

  const result = await conn.test(slug);
  console.log('test:', result);

  const ds = await factory.forTenantSlug(slug);
  if (!ds) throw new Error('no datasource');
  const rows: unknown = await ds.query('SELECT id, ean, name FROM erp_product');
  console.log('rows:', rows);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
