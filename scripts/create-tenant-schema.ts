import 'dotenv/config';
import { DataSource } from 'typeorm';
import { execSync } from 'node:child_process';
import { ModuleCode } from '../src/database/enums/module-code.enum';
import {
  RESERVED_SLUGS,
  schemaNameFor,
  SLUG_RE,
} from '../src/tenant/tenant-schema';

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npm run tenant:create <slug>');
    process.exit(1);
  }
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    throw new Error(
      `Invalid slug "${slug}". Must match ${SLUG_RE} and not be reserved (${[...RESERVED_SLUGS].join(', ')}).`,
    );
  }
  const schemaName = schemaNameFor(slug);

  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl)
    throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    entities: [],
    synchronize: false,
  });
  await ds.initialize();
  try {
    await ds.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await ds.query(
      `
      INSERT INTO core.tenant (slug, name, schema_name, status, modules)
      VALUES ($1, $2, $3, 'active', $4)
      ON CONFLICT (slug) DO NOTHING
    `,
      [slug, slug, schemaName, Object.values(ModuleCode)],
    );
    console.log(
      `Schema ${schemaName} created; tenant row inserted (or already existed).`,
    );
  } finally {
    await ds.destroy();
  }

  execSync(`npm run migration:tenant ${slug}`, { stdio: 'inherit' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
