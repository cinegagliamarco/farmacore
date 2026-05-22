import 'dotenv/config';
import { DataSource } from 'typeorm';
import { execSync } from 'node:child_process';

const RESERVED = new Set(['admin', 'api', 'app', 'meta', 'shared', 'system', 'www']);
const SLUG_RE = /^[a-z][a-z0-9-]{2,31}$/;

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npm run tenant:create <slug>');
    process.exit(1);
  }
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) {
    throw new Error(
      `Invalid slug "${slug}". Must match ${SLUG_RE} and not be reserved (${[...RESERVED].join(', ')}).`,
    );
  }
  const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    entities: [],
    synchronize: false,
  });
  await ds.initialize();
  try {
    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await ds.query(
      `
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (slug) DO NOTHING
    `,
      [slug, slug, schemaName],
    );
    console.log(`Schema ${schemaName} created; tenant row inserted (or already existed).`);
  } finally {
    await ds.destroy();
  }

  execSync(`npm run migration:tenant ${slug}`, { stdio: 'inherit' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
