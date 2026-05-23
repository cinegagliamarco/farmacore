# 03 — Integration Data Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 03 was executed with two post-execution amendments: (1) docker-compose ERP service uses host port `5435` (plan said `5433`) to avoid collision with our farmacore postgres; (2) the placeholder `IntegrationErpProductEntity` was replaced by porting the 14 legacy `integration-entities/*.entity.ts` files into `src/integration/entities/a7pharma/`, plus an `origin` column on `core.integration_database_connection` (enum `IntegrationOrigin`, v1 values: `'a7pharma'`). Per-vendor folder structure leaves room for additional ERPs.

**Goal:** Per-tenant, runtime-configurable ERP database connections. Replaces the prototype's hardcoded `INTEGRATION_DATABASE_URL` with rows in `core.integration_database_connection` (entity already created in plan 01) and a factory that builds and caches `DataSource`s per tenant. Passwords are encrypted at rest with AES-256-GCM.

**Architecture:** A `CredentialEncryptionService` wraps AES-GCM with the key from `INTEGRATION_DB_KEY`. An `IntegrationDataSourceFactory` (singleton, internal `Map` cache) returns a `DataSource | null` for a tenant id, initializes it on first use, and supports `invalidate(tenantId)` for credential rotation. A separate `integration-entities` array (TypeScript imports, not globs) declares the ERP-side entity classes. The factory is consumed by `TenantContext` (HTTP) and worker consumers (queue, plan 05).

**Tech Stack:** Node `crypto` (AES-256-GCM), TypeORM 0.3, `pg`.

**Reference:** `arc/04-integration-data-source.md` in full.

---

## Interfaces Exposed

- **Module:** `IntegrationModule` (exports the factory + encryption service).
- **Services:**
  - `CredentialEncryptionService` — `encrypt(plain: string): Buffer`, `decrypt(cipher: Buffer): Promise<string>`. Ciphertext format: `nonce(12) | tag(16) | ciphertext`.
  - `IntegrationDataSourceFactory` — `forTenant(tenantId: string): Promise<DataSource | null>`, `invalidate(tenantId: string): Promise<void>`.
  - `IntegrationConnectionService` — admin-side CRUD on the row (upsert, disable, test). Consumed by plan 06.
- **DTOs:**
  - `UpsertIntegrationDto { origin, name, host, port, database, username, password, sslMode?, sslCaCert?, readOnly?, connectionOptions? }` — `origin` is the integration vendor (`IntegrationOrigin.A7PHARMA` in v1).
- **Integration entities — per tenant, by origin:** each tenant's integration row carries an `origin` (the vendor), and `IntegrationDataSourceFactory` loads only that vendor's entity set into the tenant's `DataSource`. `src/integration/entities/index.ts` exposes `entitiesForOrigin(origin)`; v1 maps `IntegrationOrigin.A7PHARMA → A7PHARMA_ENTITIES` (14 entities ported from `legacy-app/src/database/integration-entities/`). Adding a new vendor = new folder + new enum value + new entry in the `ENTITIES_BY_ORIGIN` map. The previous "union" `INTEGRATION_ENTITIES` was removed because it would have loaded foreign tables into every tenant's connection.

---

## File Structure

```
src/integration/
├─ integration.module.ts
├─ entities/
│  ├─ index.ts                              # entitiesForOrigin(origin) — per-tenant entity set
│  ├─ numeric-column.decorator.ts           # shared @NumericColumn (used by all vendor folders)
│  └─ a7pharma/                             # ported from legacy integration-entities/
│     ├─ index.ts                           # A7PHARMA_ENTITIES (14 entities)
│     ├─ caderno-oferta.entity.ts
│     ├─ classificacao.entity.ts
│     ├─ classificacao-produto.entity.ts
│     ├─ custo-produto.entity.ts
│     ├─ embalagem.entity.ts
│     ├─ estoque.entity.ts
│     ├─ fabricante.entity.ts
│     ├─ item-caderno-oferta.entity.ts
│     ├─ item-caderno-oferta-quantidade.entity.ts
│     ├─ item-recebimento-fisico.entity.ts
│     ├─ pessoa.entity.ts
│     ├─ principio-ativo.entity.ts
│     ├─ produto.entity.ts
│     └─ recebimento-fisico.entity.ts
├─ credential-encryption.service.ts
├─ credential-encryption.service.spec.ts
├─ integration-data-source.factory.ts
├─ integration-data-source.factory.spec.ts
├─ integration-connection.service.ts
└─ dto/
   └─ upsert-integration.dto.ts
```

---

### Task 1: CredentialEncryptionService (AES-256-GCM)

**Files:** `src/integration/credential-encryption.service.ts`, `.spec.ts`

- [x] **Step 1: Failing test**

```ts
import { CredentialEncryptionService } from './credential-encryption.service';

describe('CredentialEncryptionService', () => {
  // 32 bytes of zero is fine for a deterministic test key.
  const key = Buffer.alloc(32);
  const svc = new CredentialEncryptionService({ integrationDbKey: key } as never);

  it('roundtrips plaintext', async () => {
    const cipher = svc.encrypt('hunter2');
    expect(cipher).toBeInstanceOf(Buffer);
    expect(cipher.length).toBeGreaterThan(12 + 16); // nonce + tag minimum
    await expect(svc.decrypt(cipher)).resolves.toBe('hunter2');
  });

  it('produces different ciphertext each time (random nonce)', () => {
    const a = svc.encrypt('hunter2');
    const b = svc.encrypt('hunter2');
    expect(a.equals(b)).toBe(false);
  });

  it('rejects tampered ciphertext', async () => {
    const cipher = svc.encrypt('hunter2');
    cipher[cipher.length - 1] ^= 0x01;            // flip a bit in tag
    await expect(svc.decrypt(cipher)).rejects.toThrow();
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/integration/credential-encryption.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class CredentialEncryptionService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    const key = config.integrationDbKey;
    if (key.length !== 32) throw new Error('INTEGRATION_DB_KEY must decode to 32 bytes');
    this.key = key;
  }

  public encrypt(plain: string): Buffer {
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, nonce);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([nonce, tag, ct]);
  }

  public async decrypt(payload: Buffer): Promise<string> {
    if (payload.length < NONCE_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
    const nonce = payload.subarray(0, NONCE_BYTES);
    const tag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ct = payload.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/integration/credential-encryption.service.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/integration/credential-encryption.service.ts src/integration/credential-encryption.service.spec.ts
git commit -m "feat(integration): AES-256-GCM CredentialEncryptionService"
```

---

### Task 2: Integration entities — per-vendor folders

**Files:**
- `src/integration/entities/numeric-column.decorator.ts` (shared)
- `src/integration/entities/a7pharma/*.entity.ts` (14 entities)
- `src/integration/entities/a7pharma/index.ts` (`A7PHARMA_ENTITIES`)
- `src/integration/entities/index.ts` (`entitiesForOrigin(origin)` — per-tenant entity set selector)

> **Post-execution amendment:** the original plan punted on real ERP columns with a single placeholder `IntegrationErpProductEntity`. That was replaced by porting the 14 legacy `integration-entities/*.entity.ts` files into `src/integration/entities/a7pharma/`, with a per-vendor folder structure so future ERPs land cleanly. See commit `6ef211a`.

- [x] **Step 1: Shared `NumericColumn` decorator**

`src/integration/entities/numeric-column.decorator.ts` — PG returns `NUMERIC` as string over the wire, transformer parses to number. Reused across all vendor entity folders.

- [x] **Step 2: Port legacy A7Pharma entities**

For each file in `legacy-app/src/database/integration-entities/`, create the same entity under `src/integration/entities/a7pharma/`:
- Rename `XxxTypeormEntity` → `XxxEntity`.
- Keep Portuguese class + property names (they map 1:1 to the A7Pharma DB columns).
- All entities are `synchronize: false` (schema is owned by the customer ERP).

- [x] **Step 3: Vendor barrel**

`src/integration/entities/a7pharma/index.ts`:
```ts
export const A7PHARMA_ENTITIES = [
  CadernoOfertaEntity, ClassificacaoEntity, ClassificacaoProdutoEntity,
  CustoProdutoEntity, EmbalagemEntity, EstoqueEntity, FabricanteEntity,
  ItemCadernoOfertaEntity, ItemCadernoOfertaQuantidadeEntity,
  ItemRecebimentoFisicoEntity, PessoaEntity, PrincipioAtivoEntity,
  ProdutoEntity, RecebimentoFisicoEntity,
];
```

- [x] **Step 4: Per-origin selector**

`src/integration/entities/index.ts` — the factory loads the entity set matching the tenant row's `origin`. A new vendor adds one line to `ENTITIES_BY_ORIGIN`.

```ts
import { IntegrationOrigin } from '../../database/enums/integration-origin.enum';
import { A7PHARMA_ENTITIES } from './a7pharma';

export { A7PHARMA_ENTITIES } from './a7pharma';
export { NumericColumn, numericTransformer } from './numeric-column.decorator';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
type EntityList = ReadonlyArray<Function>;

const ENTITIES_BY_ORIGIN: Record<IntegrationOrigin, EntityList> = {
  [IntegrationOrigin.A7PHARMA]: A7PHARMA_ENTITIES,
};

export function entitiesForOrigin(origin: IntegrationOrigin): EntityList {
  return ENTITIES_BY_ORIGIN[origin];
}
```

- [x] **Step 5: Commit**

```bash
git add src/integration/entities/
git commit -m "feat(integration): port 14 A7Pharma entities into entities/a7pharma/"
```

---

### Task 3: IntegrationDataSourceFactory

**Files:** `src/integration/integration-data-source.factory.ts`, `.spec.ts`

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';

// Mock DataSource constructor at module level
jest.mock('typeorm', () => {
  const actual = jest.requireActual('typeorm');
  return {
    ...actual,
    DataSource: jest.fn().mockImplementation(() => ({
      isInitialized: false,
      initialize: jest.fn().mockImplementation(function (this: { isInitialized: boolean }) {
        this.isInitialized = true;
        return Promise.resolve(this);
      }),
      destroy: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

describe('IntegrationDataSourceFactory', () => {
  let factory: IntegrationDataSourceFactory;
  let repo: { findOne: jest.Mock };
  let crypto: { decrypt: jest.Mock };
  const cipher = Buffer.from('cipher');

  beforeEach(async () => {
    repo = { findOne: jest.fn() };
    crypto = { decrypt: jest.fn().mockResolvedValue('secret') };
    const mod = await Test.createTestingModule({
      providers: [
        IntegrationDataSourceFactory,
        { provide: getRepositoryToken(IntegrationDatabaseConnectionEntity), useValue: repo },
        { provide: CredentialEncryptionService, useValue: crypto },
      ],
    }).compile();
    factory = mod.get(IntegrationDataSourceFactory);
  });

  it('returns null when no row exists', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(factory.forTenant('tid')).resolves.toBeNull();
  });

  it('initializes and caches the DataSource', async () => {
    repo.findOne.mockResolvedValue({
      tenantId: 'tid', host: 'h', port: 5432, database: 'd', username: 'u',
      passwordEncrypted: cipher, sslMode: 'require', sslCaCert: null,
      type: 'postgres', readOnly: true, connectionOptions: {}, status: 'active',
    });
    const a = await factory.forTenant('tid');
    const b = await factory.forTenant('tid');
    expect(a).toBe(b);              // cache hit
    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(DataSource).toHaveBeenCalledTimes(1);
  });

  it('invalidate destroys and removes from cache', async () => {
    repo.findOne.mockResolvedValue({
      tenantId: 'tid', host: 'h', port: 5432, database: 'd', username: 'u',
      passwordEncrypted: cipher, sslMode: 'require', sslCaCert: null,
      type: 'postgres', readOnly: true, connectionOptions: {}, status: 'active',
    });
    const ds = await factory.forTenant('tid');
    await factory.invalidate('tid');
    expect((ds as { destroy: jest.Mock }).destroy).toHaveBeenCalled();
    await factory.forTenant('tid');
    expect(repo.findOne).toHaveBeenCalledTimes(2);  // refetched
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/integration/integration-data-source.factory.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { entitiesForOrigin } from './entities';

@Injectable()
export class IntegrationDataSourceFactory implements OnModuleDestroy {
  private readonly logger = new Logger(IntegrationDataSourceFactory.name);
  private readonly cache = new Map<string, DataSource>();

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity)
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    private readonly crypto: CredentialEncryptionService,
  ) {}

  public async forTenant(tenantId: string): Promise<DataSource | null> {
    const cached = this.cache.get(tenantId);
    if (cached?.isInitialized) return cached;

    const row = await this.repo.findOne({ where: { tenantId, status: 'active' } });
    if (!row) return null;

    const password = await this.crypto.decrypt(row.passwordEncrypted);
    const poolSize = Number((row.connectionOptions as { poolSize?: number })?.poolSize ?? 5);

    const dataSource = new DataSource({
      type: row.type,
      host: row.host,
      port: row.port,
      database: row.database,
      username: row.username,
      password,
      ssl: row.sslMode === 'disable'
        ? false
        : {
            rejectUnauthorized: row.sslMode === 'verify-full',
            ca: row.sslCaCert ?? undefined,
          },
      entities: [...entitiesForOrigin(row.origin)],
      synchronize: false,
      logging: false,
      extra: { ...(row.connectionOptions ?? {}), max: poolSize },
      // Enforce read-only at the connection level when the row says so.
      schema: undefined,
    });

    await dataSource.initialize();
    if (row.readOnly) {
      await dataSource.query(`SET default_transaction_read_only = on`);
    }

    this.cache.set(tenantId, dataSource);
    this.logger.log(`Initialized integration DataSource for tenant ${tenantId}`);
    return dataSource;
  }

  public async invalidate(tenantId: string): Promise<void> {
    const ds = this.cache.get(tenantId);
    if (ds?.isInitialized) await ds.destroy();
    this.cache.delete(tenantId);
  }

  public async onModuleDestroy(): Promise<void> {
    for (const [, ds] of this.cache) {
      if (ds.isInitialized) await ds.destroy().catch(() => undefined);
    }
    this.cache.clear();
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/integration/integration-data-source.factory.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/integration/integration-data-source.factory.ts src/integration/integration-data-source.factory.spec.ts
git commit -m "feat(integration): IntegrationDataSourceFactory with cache + invalidate"
```

---

### Task 4: UpsertIntegrationDto

**Files:** `src/integration/dto/upsert-integration.dto.ts`

- [x] **Step 1: Implement**

```ts
import { IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { SslMode } from '../../database/entities/core/integration-database-connection.entity';
import { IntegrationOrigin } from '../../database/enums/integration-origin.enum';

export class UpsertIntegrationDto {
  @IsEnum(IntegrationOrigin)
  origin!: IntegrationOrigin;          // vendor: v1 supports 'a7pharma' only

  @IsString() @Length(1, 200)
  name!: string;

  @IsString() @Length(1, 255)
  host!: string;

  @IsInt() @Min(1) @Max(65535)
  port!: number;

  @IsString() @Length(1, 128)
  database!: string;

  @IsString() @Length(1, 128)
  username!: string;

  @IsString() @Length(1, 1024)
  password!: string;

  @IsOptional() @IsIn(['disable', 'require', 'verify-full'])
  sslMode?: SslMode;

  @IsOptional() @IsString()
  sslCaCert?: string;

  @IsOptional() @IsBoolean()
  readOnly?: boolean;

  @IsOptional() @IsObject()
  connectionOptions?: Record<string, unknown>;
}
```

- [x] **Step 2: Commit**

```bash
git add src/integration/dto/
git commit -m "feat(integration): UpsertIntegrationDto"
```

---

### Task 5: IntegrationConnectionService

**Files:** `src/integration/integration-connection.service.ts`

- [x] **Step 1: Implement**

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  IntegrationDatabaseConnectionEntity,
} from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto';
import { entitiesForOrigin } from './entities';

@Injectable()
export class IntegrationConnectionService {
  private readonly logger = new Logger(IntegrationConnectionService.name);

  constructor(
    @InjectRepository(IntegrationDatabaseConnectionEntity)
    private readonly repo: Repository<IntegrationDatabaseConnectionEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenants: Repository<TenantEntity>,
    private readonly crypto: CredentialEncryptionService,
    private readonly factory: IntegrationDataSourceFactory,
  ) {}

  public async upsert(tenantSlug: string, dto: UpsertIntegrationDto): Promise<IntegrationDatabaseConnectionEntity> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);

    const existing = await this.repo.findOne({ where: { tenantId: tenant.id } });
    const payload: Partial<IntegrationDatabaseConnectionEntity> = {
      tenantId: tenant.id,
      name: dto.name,
      type: 'postgres',
      host: dto.host,
      port: dto.port,
      database: dto.database,
      username: dto.username,
      passwordEncrypted: this.crypto.encrypt(dto.password),
      sslMode: dto.sslMode ?? 'require',
      sslCaCert: dto.sslCaCert ?? null,
      readOnly: dto.readOnly ?? true,
      connectionOptions: dto.connectionOptions ?? {},
      status: 'active',
    };

    const saved = existing
      ? await this.repo.save({ ...existing, ...payload })
      : await this.repo.save(payload);

    await this.factory.invalidate(tenant.id);
    return saved;
  }

  public async disable(tenantSlug: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row) return;
    row.status = 'disabled';
    await this.repo.save(row);
    await this.factory.invalidate(tenant.id);
  }

  public async test(tenantSlug: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const tenant = await this.tenants.findOne({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException(`Tenant ${tenantSlug} not found`);
    const row = await this.repo.findOne({ where: { tenantId: tenant.id } });
    if (!row) throw new NotFoundException('No integration connection configured');

    const password = await this.crypto.decrypt(row.passwordEncrypted);
    const ds = new DataSource({
      type: 'postgres',
      host: row.host, port: row.port, database: row.database, username: row.username, password,
      ssl: row.sslMode === 'disable' ? false : { rejectUnauthorized: row.sslMode === 'verify-full', ca: row.sslCaCert ?? undefined },
      entities: [...entitiesForOrigin(row.origin)],
      synchronize: false,
    });
    try {
      await ds.initialize();
      await ds.query('SELECT 1');
      row.lastVerifiedAt = new Date();
      row.lastError = null;
      await this.repo.save(row);
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      row.lastError = message;
      await this.repo.save(row);
      return { ok: false, error: message };
    } finally {
      if (ds.isInitialized) await ds.destroy().catch(() => undefined);
    }
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/integration/integration-connection.service.ts
git commit -m "feat(integration): IntegrationConnectionService (upsert/disable/test)"
```

---

### Task 6: IntegrationModule

**Files:** `src/integration/integration.module.ts`

- [x] **Step 1: Implement**

```ts
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { IntegrationConnectionService } from './integration-connection.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IntegrationDatabaseConnectionEntity, TenantEntity])],
  providers: [CredentialEncryptionService, IntegrationDataSourceFactory, IntegrationConnectionService],
  exports: [CredentialEncryptionService, IntegrationDataSourceFactory, IntegrationConnectionService],
})
export class IntegrationModule {}
```

- [x] **Step 2: Wire into AppModule and WorkerModule**

Modify both `src/app.module.ts` and `src/worker.module.ts` — add `IntegrationModule` to `imports`.

- [x] **Step 3: Commit**

```bash
git add src/integration/integration.module.ts src/app.module.ts src/worker.module.ts
git commit -m "feat(integration): IntegrationModule wired into API + worker"
```

---

### Task 7: TenantContext exposes integration data source

**Files:** `src/tenant/tenant.context.ts` (modify), `src/tenant/tenant.module.ts` (no change — `IntegrationModule` is `@Global()`)

> **Decision:** Keep `TenantContext` storing only JWT claims; integration lookups happen by calling `integrationFactory.forTenant(tenantId)` directly from services. Avoids coupling the request-scoped provider to async initialization. The arc doc (`arc/03 §5`) mentions a convenience accessor — we leave that as a documented service method `IntegrationDataSourceFactory.forTenantSlug(slug)`.

- [x] **Step 1: Add a slug → uuid lookup**

Append to `IntegrationDataSourceFactory`:

```ts
// ...existing...
public async forTenantSlug(tenantSlug: string): Promise<DataSource | null> {
  const tenant = await this.repo.manager.findOne(TenantEntity, { where: { slug: tenantSlug } });
  if (!tenant) return null;
  return this.forTenant(tenant.id);
}
```

Add the `TenantEntity` import. (Calling sites can use either uuid or slug; both go through the same cache because keys are the uuid.)

- [x] **Step 2: Commit**

```bash
git add src/integration/integration-data-source.factory.ts
git commit -m "feat(integration): forTenantSlug() convenience accessor"
```

---

### Task 8: Smoke test against a real ERP container

**Files:** `docker-compose.yml` (modify — add an "erp" service)

- [x] **Step 1: Add ERP service**

Append to `docker-compose.yml`:

```yaml
  erp:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: erp
      POSTGRES_PASSWORD: erp
      POSTGRES_DB: erp
    ports: ["5433:5432"]
    volumes: ["erpdata:/var/lib/postgresql/data"]

# add to volumes:
#   erpdata:
```

(Adjust the existing `volumes:` block to include `erpdata:`.)

- [x] **Step 2: Bring it up and seed**

```bash
docker compose up -d erp
sleep 3
psql postgres://erp:erp@localhost:5433/erp <<'SQL'
CREATE TABLE erp_product (id text PRIMARY KEY, ean text, name text);
INSERT INTO erp_product VALUES ('1', '7891111111111', 'Sample');
SQL
```

- [x] **Step 3: Manual integration test script**

Create `scripts/smoke-integration.ts`:

```ts
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
  await conn.upsert(slug, {
    name: 'Local ERP',
    host: 'localhost',
    port: 5433,
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
  const rows = await ds.query('SELECT id, ean, name FROM erp_product');
  console.log('rows:', rows);
  await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 4: Run it**

```bash
npm run migration:run:app
npm run tenant:create acme || true
ts-node scripts/smoke-integration.ts acme
```

Expected output:
```
test: { ok: true }
rows: [ { id: '1', ean: '7891111111111', name: 'Sample' } ]
```

- [x] **Step 5: Commit**

```bash
git add docker-compose.yml scripts/smoke-integration.ts
git commit -m "test(integration): docker erp + smoke script"
```

---

## Exit Criteria

- [x] `IntegrationDataSourceFactory.forTenant(tenantId)` returns `DataSource` for active rows and `null` for missing/disabled tenants.
- [x] Two tenants pointing at two different ERPs get two independent `DataSource`s, both cached.
- [x] `IntegrationConnectionService.upsert()` followed by `forTenant()` returns the new credentials (cache invalidated on upsert).
- [x] `IntegrationConnectionService.test()` updates `last_verified_at` / `last_error`.
- [x] Passwords stored as `bytea` (AES-256-GCM); plaintext never logged.
- [x] `process.env.INTEGRATION_DATABASE_URL` is referenced nowhere in the codebase (`grep -r INTEGRATION_DATABASE_URL src/ test/ scripts/` returns nothing).
- [x] Smoke script reads rows from the local ERP container.
