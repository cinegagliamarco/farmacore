import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';

async function resolveSchemaName(
  directUrl: string,
  slug: string,
): Promise<string> {
  if (slug === 'system') return 'system';
  const lookup = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    entities: [],
    synchronize: false,
  });
  await lookup.initialize();
  try {
    const rows: Array<{ schema_name: string }> = await lookup.query(
      `SELECT schema_name FROM core.tenant WHERE slug = $1 LIMIT 1`,
      [slug],
    );
    if (rows.length === 0)
      throw new Error(`No tenant row found for slug "${slug}"`);
    return rows[0].schema_name;
  } finally {
    await lookup.destroy();
  }
}

async function migrateOne(slug: string): Promise<void> {
  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl)
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const schemaName = await resolveSchemaName(directUrl, slug);

  const ds = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    schema: schemaName,
    entities: [],
    migrations: [path.resolve(__dirname, '../migrations/tenant/*.{ts,js}')],
    migrationsTableName: 'migrations_tenant',
  });

  await ds.initialize();
  try {
    const queryRunner = ds.createQueryRunner();
    await queryRunner.query(
      `SET search_path TO "${schemaName}", shared_catalog, public`,
    );
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
