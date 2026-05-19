# 04 — Configurable Integration Data Source

**Date:** 2026-05-12
**Status:** Draft

## 1. Purpose

Replace the prototype's hardcoded `INTEGRATION_DATABASE_URL` env-var with a **per-tenant, runtime-configurable** connection to the tenant's ERP database.

This is the refactor of `farmacore/src/database/integration.typeorm.data-source.ts`.

## 2. The Prototype Today

```ts
// farmacore/src/database/integration.typeorm.data-source.ts
if (!process.env.INTEGRATION_DATABASE_URL) throw new Error('Missing Integration Database URL');

const config: Record<string, unknown> = {
  type: 'postgres',
  url: process.env.INTEGRATION_DATABASE_URL,
  entities: [`${__dirname}/integration-entities/*.entity.{ts,js}`],
  ssl: false
};

export const IntegrationTypeOrmDataSource = new DataSource(config as unknown as DataSourceOptions);
```

Problems for the new model:

- One global URL — cannot serve multiple tenants pointing at different ERPs.
- Loaded at import time — fails fast even when the app doesn't need the integration source (e.g., serving non-ERP endpoints).
- No SSL — fine for the prototype but unsafe in production against remote ERPs.
- Hardcoded `entities` path coupled to a specific directory layout.

## 3. Target Design

### The `integration_database_connection` table (in `app_meta`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `tenant_id` | `uuid` | FK → `tenant.id`, **unique** (one ERP source per tenant for v1) |
| `name` | `text` | Human-readable label (e.g. "Pharmacy ERP — Production") |
| `type` | `enum('postgres')` | Reserved for future drivers (MySQL, SQL Server, etc.) |
| `host` | `text` | |
| `port` | `int` | |
| `database` | `text` | |
| `username` | `text` | |
| `password_encrypted` | `bytea` | AES-GCM encrypted with the app's KMS key (see §6) |
| `ssl_mode` | `enum('disable','require','verify-full')` | Default `require` for v1 |
| `ssl_ca_cert` | `text`, nullable | PEM cert if `verify-full` |
| `read_only` | `boolean` | Default `true` (we should only read from ERPs) |
| `connection_options` | `jsonb` | Optional extra TypeORM options |
| `status` | `enum('active','disabled','error')` | |
| `last_verified_at` | `timestamptz`, nullable | Timestamp of last successful health check |
| `last_error` | `text`, nullable | |
| `created_at`, `updated_at` | `timestamptz` | |

### The new `IntegrationDataSourceFactory`

```ts
@Injectable()
export class IntegrationDataSourceFactory {
  private readonly cache = new Map<string, DataSource>();

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity, 'app_meta')
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    private readonly crypto: CredentialEncryptionService
  ) {}

  public async forTenant(tenantId: string): Promise<DataSource | null> {
    const cached = this.cache.get(tenantId);
    if (cached?.isInitialized) return cached;

    const row = await this.repo.findOne({ where: { tenantId, status: 'active' } });
    if (!row) return null;

    const password = await this.crypto.decrypt(row.passwordEncrypted);
    const dataSource = new DataSource({
      type: row.type,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password,
      ssl: row.sslMode === 'disable' ? false : { rejectUnauthorized: row.sslMode === 'verify-full', ca: row.sslCaCert ?? undefined },
      entities: integrationEntities, // imported list, no glob
      synchronize: false,
      logging: false,
      extra: row.connectionOptions ?? {},
    });

    await dataSource.initialize();
    this.cache.set(tenantId, dataSource);
    return dataSource;
  }

  public async invalidate(tenantId: string): Promise<void> {
    const ds = this.cache.get(tenantId);
    if (ds?.isInitialized) await ds.destroy();
    this.cache.delete(tenantId);
  }
}
```

### Key changes vs the prototype

| Concern | Prototype | New |
|---|---|---|
| URL source | `process.env.INTEGRATION_DATABASE_URL` | `app_meta.integration_database_connection` row, looked up by `tenantId` |
| Entity discovery | Filesystem glob | Imported `integrationEntities` array (no `__dirname`, works in any bundler) |
| SSL | `ssl: false` | Default `require`; configurable per row |
| Failure mode | Throws at module load | Returns `null` when no source is configured; consumer decides whether the step can run without ERP data |
| Caching | Single global instance | Per-tenant cache, invalidatable on credential rotation |
| Read/write | Implicit | `read_only` column documented at the row level; enforced by setting `default_transaction_read_only=on` on connect when true |

## 4. Wiring into the App

- The `TenantContext` (defined in `03-auth-and-tenancy.md`) exposes an `integrationDataSource: DataSource | null` accessor backed by `IntegrationDataSourceFactory.forTenant(tenantId)`. Note that the integration source is *still its own `DataSource`* — it points at an external ERP, not at our app DB. Only the app-side data was collapsed to schema-per-tenant.
- Workers (queue consumers in `02-queue-and-routines.md`) resolve `integrationDataSource` from the message's `tenantId` before each step.
- Steps that **require** integration data check for `null` and either:
  - Skip with a logged warning (matches the prototype's current behavior in `requireIntegrationRepositories`), or
  - Fail and DLQ the message (depending on the step's criticality — caller chooses).

## 5. Admin API

Two endpoints under `/admin/tenants/:slug/integration` (admin-only):

- `PUT` — upsert the tenant's integration connection. Body: `{ host, port, database, username, password, sslMode, sslCaCert?, connectionOptions? }`.
- `POST /test` — try to `initialize()` a DataSource with the row and run `SELECT 1`. Update `last_verified_at` or `last_error` on `integration_database_connection`. Does **not** persist credentials if `body` is provided inline — only the stored row.
- `DELETE` — disable the row (`status=disabled`) and `invalidate()` the cache. We never hard-delete credentials; we soft-disable.

## 6. Credential Encryption

- Passwords are encrypted at rest with **AES-256-GCM**.
- The encryption key is loaded from a Fly secret (`INTEGRATION_DB_KEY`, 32 bytes base64).
- The `CredentialEncryptionService` exposes `encrypt(plain: string): Buffer` and `decrypt(cipher: Buffer): Promise<string>`. Nonces are stored alongside ciphertext.
- Key rotation: support N active decryption keys, one active encryption key; rotate via a one-off script.

**Note:** this is symmetric encryption with a single key for v1 — not envelope encryption with a KMS. Upgrade path: replace `CredentialEncryptionService` with a KMS-backed implementation when justified by compliance or a security review. The interface stays the same.

## 7. Local Dev

- For local dev a tenant can be configured with `host=host.docker.internal` pointing at a local Postgres mirror of the ERP schema.
- A seeder command (`npm run seed:integration -- --tenant=acme --dump=path/to/erp.sql`) loads a real anonymized ERP dump into a local DB for end-to-end testing.

## 8. Open Questions

- Connection pool size per integration DataSource? **Default: 5**, configurable per row via `connection_options.poolSize` when an ERP can't handle that many connections.
- Should we support read replicas (`host` + `replicaHost`)? **Default: no for v1**; add an optional `replica_host` column when a tenant asks.
- Health check schedule — passive (update `last_verified_at` only when a step succeeds) or active (cron job pings every N minutes)? **Default: passive for v1**, active when an alerting need appears.

## 9. Success Criteria

- An `IntegrationDataSourceFactory.forTenant(tenantId)` call returns a working `DataSource` for tenants with an active row, and `null` for tenants without.
- Two tenants pointing at two different ERPs both run their pipelines end-to-end without code changes.
- Rotating a tenant's password via the admin API takes effect on the next worker job (cache invalidated).
- Passwords are never written to logs or returned by any API.
- The prototype's `INTEGRATION_DATABASE_URL` env-var no longer exists anywhere in the new project.
