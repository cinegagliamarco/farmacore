import 'dotenv/config';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { DataSource } from 'typeorm';

// Local-dev seed: the first tenant and the ERP integration it points at.
// Reproducible counterpart to TUTORIAL.md §2 — replaces the manual
// `tenant:create` + `curl PUT .../integration` dance with one command.
const SLUG = 'macfarma';
const INTEGRATION = {
  origin: 'a7pharma',
  name: 'Macfarma ERP (ngrok)',
  host: '5.tcp.ngrok.io',
  port: 28501,
  database: 'ultrapopularbariri_loja01_20231116',
  username: 'leitura_053401619_101224',
  password: 'qnseXKaq1HXtxR8',
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
    const [tenant] = await ds.query(`SELECT id FROM core.tenant WHERE slug = $1`, [SLUG]);
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
  } finally {
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
