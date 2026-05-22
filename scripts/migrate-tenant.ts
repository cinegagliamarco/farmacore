import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';

async function migrateOne(slug: string): Promise<void> {
  const schemaName = slug === 'system' ? 'system' : `tenant_${slug}`;
  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    schema: schemaName,
    entities: [],
    migrations: [path.resolve(__dirname, '../migrations/tenant/*.{ts,js}')],
    migrationsTableName: 'migrations_tenant',
  });

  await ds.initialize();
  try {
    const queryRunner = ds.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schemaName}", shared_catalog, public`);
    await queryRunner.release();

    const applied = await ds.runMigrations({ transaction: 'each' });
    console.log(`[${slug}] applied ${applied.length} migration(s)`);
  } finally {
    await ds.destroy();
  }
}

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: npm run migration:tenant <slug>');
  process.exit(1);
}
migrateOne(slug).catch((err) => {
  console.error(err);
  process.exit(1);
});
