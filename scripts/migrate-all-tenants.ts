import 'dotenv/config';
import { DataSource } from 'typeorm';
import { spawn } from 'node:child_process';

async function main(): Promise<void> {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres',
    url,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    entities: [],
    synchronize: false,
  });
  await ds.initialize();

  let tenants: Array<{ slug: string }>;
  try {
    tenants = await ds.query(
      `SELECT slug FROM core.tenant WHERE status = 'active' AND slug <> 'system' ORDER BY slug`,
    );
  } finally {
    await ds.destroy();
  }

  const CONCURRENCY = 10;
  let cursor = 0;
  const failures: Array<{ slug: string; error: string }> = [];

  // spawn (not execSync): execSync blocks the event loop, which would
  // serialize the workers and make CONCURRENCY meaningless.
  const migrate = (slug: string): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn('npm', ['run', 'migration:tenant', slug], {
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`exit code ${code}`)),
      );
    });

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= tenants.length) return;
      const slug = tenants[i].slug;
      try {
        await migrate(slug);
      } catch (err) {
        failures.push({ slug, error: (err as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (failures.length > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
  console.log(`Migrated ${tenants.length} tenant(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
