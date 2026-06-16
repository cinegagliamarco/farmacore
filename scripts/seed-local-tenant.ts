import 'dotenv/config';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { DataSource } from 'typeorm';
import { CompetitorOrigin } from '../src/database/enums/competitor-origin.enum';

// Local-dev seed: the first tenant and the ERP integration it points at.
// Reproducible counterpart to TUTORIAL.md §2 — replaces the manual
// `tenant:create` + `curl PUT .../integration` dance with one command.
// Points at the local docker `erp` container (seeded with the A7Pharma sample
// via docker/erp-seed). The real customer ERP lives behind an ngrok tunnel —
// that connection is wired per environment, not in the local seed.
const SLUG = 'macfarma';
const INTEGRATION = {
  origin: 'a7pharma',
  name: 'Local ERP',
  host: 'localhost',
  port: 5435,
  database: 'erp',
  username: 'erp',
  password: 'erp',
  sslMode: 'disable',
};

// Matches CredentialEncryptionService: nonce(12) + tag(16) + ciphertext.
function encrypt(plain: string, key: Buffer): Buffer {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]);
}

async function main(): Promise<void> {
  const key = Buffer.from(process.env.INTEGRATION_DB_KEY ?? '', 'base64');
  if (key.length !== 32)
    throw new Error('INTEGRATION_DB_KEY must decode to 32 bytes');

  // Schema + tenant row + tenant migrations.
  execSync(`npm run tenant:create ${SLUG}`, { stdio: 'inherit' });

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
    const [tenant] = await ds.query(`SELECT id, schema_name FROM core.tenant WHERE slug = $1`, [SLUG]);
    if (!tenant) throw new Error(`tenant ${SLUG} not found after create`);

    await ds.query(
      `
      INSERT INTO core.integration_database_connection
        (tenant_id, origin, name, host, port, database, username,
         password_encrypted, ssl_mode, read_only, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET
        origin = EXCLUDED.origin,
        name = EXCLUDED.name,
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        database = EXCLUDED.database,
        username = EXCLUDED.username,
        password_encrypted = EXCLUDED.password_encrypted,
        ssl_mode = EXCLUDED.ssl_mode,
        status = 'active',
        updated_at = now()
    `,
      [
        tenant.id,
        INTEGRATION.origin,
        INTEGRATION.name,
        INTEGRATION.host,
        INTEGRATION.port,
        INTEGRATION.database,
        INTEGRATION.username,
        encrypt(INTEGRATION.password, key),
        INTEGRATION.sslMode,
      ],
    );
    console.log(`Tenant ${SLUG} integration wired → ${INTEGRATION.host}:${INTEGRATION.port}/${INTEGRATION.database}`);

    // Mirror tenant-onboarding.service.ts: seed every origin disabled so the
    // admin competitor-origins PUT (UPDATE-only) has rows to flip.
    await ds.query(`SET search_path TO "${tenant.schema_name}", shared_catalog, public`);
    for (const origin of Object.values(CompetitorOrigin)) {
      await ds.query(
        `INSERT INTO tenant_competitor_origin (origin, enabled) VALUES ($1, false)
         ON CONFLICT (origin) DO NOTHING`,
        [origin],
      );
    }
    console.log(`Tenant ${SLUG} competitor origins seeded (${Object.values(CompetitorOrigin).length} disabled)`);
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
