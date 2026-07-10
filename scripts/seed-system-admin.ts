import 'dotenv/config';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@system.local';
  const password =
    process.env.SEED_ADMIN_PASSWORD ?? 'changeme-please-32-chars-or-more';
  if (password.length < 12)
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 chars');

  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres',
    url,
    entities: [],
    synchronize: false,
  });
  await ds.initialize();
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await ds.query(
      `INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
       VALUES ('system', $1, $2, 'admin', 'active')
       ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [email, hash],
    );
    console.log(`System admin upserted: ${email}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
