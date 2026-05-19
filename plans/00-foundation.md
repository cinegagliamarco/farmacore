# 00 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the NestJS project with config, health endpoint, Dockerfile, single entry point that switches between API and worker roles via `WORKER_MODE`, and TypeORM scaffolding so every later plan has a stable base. Logger + interceptors + signal listener are added in plan 09.

**Architecture:** Single Docker image with one entry file `src/main.ts`. When `WORKER_MODE=1`, it creates a `NestApplicationContext` (no HTTP) and the worker module's consumers attach themselves to RMQ. Otherwise it creates a full `NestApplication`, listens on `PORT`, and serves HTTP. A `ConfigModule` reads typed env vars; a `DatabaseModule` registers the root TypeORM `DataSource`; a `HealthModule` exposes `/health`.

**Tech Stack:** NestJS 11, TypeORM 0.3, `@nestjs/config`, `class-validator`, Docker (multi-stage build). **Package manager: npm.**

**Reference:** `arc/00-architecture.md` §5 "Two Fly apps from one Docker image" — same image, same code, role selected at runtime by env var (we collapse the two entry files into one for simplicity). `arc/05-provisioning-tutorial.md` §4–§5.

---

## Interfaces Exposed

Other plans depend on these:

- **Config keys** (read via `ConfigService`):
  - `NODE_ENV`, `PORT`, `WORKER_MODE`
  - `DATABASE_URL` (Neon pooled), `DATABASE_DIRECT_URL` (Neon non-pooled, for migrations + `CREATE SCHEMA`)
  - `AMQP_URL`
  - `JWT_SECRET`
  - `INTEGRATION_DB_KEY` (32-byte base64)
  - `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_KEY_PREFIX`
- **Entry point:** `dist/main.js`. CMD `node dist/main.js`.
- **NestJS modules already present:** `AppConfigModule` (global), `DatabaseModule`, `HealthModule`. (Logger + interceptors arrive in plan 09.)
- **TypeORM:** `TypeOrmModule.forRootAsync()` reads `DATABASE_URL`. Entities loaded per-feature via `TypeOrmModule.forFeature([...])`.

---

## File Structure

```
src/
├─ main.ts                     # single entry — switches role by WORKER_MODE
├─ app.module.ts               # API role module
├─ worker.module.ts            # Worker role module (added in plan 04)
├─ config/
│  ├─ config.module.ts
│  ├─ env.validation.ts
│  └─ app-config.service.ts
├─ health/
│  ├─ health.module.ts
│  └─ health.controller.ts
└─ database/
   └─ database.module.ts
Dockerfile
.dockerignore
.env.example
docker-compose.yml
```

The scaffold files `src/app.controller.*`, `src/app.service.*`, `src/main.ts` (the nest-new placeholder) are deleted in Task 2.

---

### Task 1: Install foundation deps

**Files:**
- Modify: `package.json`
- Create: `package-lock.json` (npm)

- [ ] **Step 1: Confirm working tree is clean and using npm**

Run: `ls package-lock.json` — should exist (npm default).
Run: `npm --version` — should print v9+.

- [ ] **Step 2: Install runtime deps**

```bash
npm install @nestjs/config @nestjs/typeorm typeorm pg \
  class-validator class-transformer \
  @nestjs/terminus
```

- [ ] **Step 3: Install dev deps**

```bash
npm install -D @types/pg
```

- [ ] **Step 4: Verify install + build**

Run: `npm install && npm run build`
Expected: build succeeds; `dist/` populated.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install foundation deps"
```

---

### Task 2: Delete scaffold files

**Files:**
- Delete: `src/app.controller.ts`, `src/app.controller.spec.ts`, `src/app.service.ts`, `src/main.ts`

- [ ] **Step 1: Remove files**

```bash
rm src/app.controller.ts src/app.controller.spec.ts src/app.service.ts src/main.ts
```

- [ ] **Step 2: Strip imports from app.module.ts**

```ts
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/
git commit -m "chore: remove nest-new scaffold files"
```

---

### Task 3: Config module with validated env

**Files:**
- Create: `src/config/env.validation.ts`
- Create: `src/config/app-config.service.ts`
- Create: `src/config/config.module.ts`
- Create: `.env.example`

- [ ] **Step 1: Write failing test**

Create `src/config/env.validation.spec.ts`:

```ts
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'test',
    PORT: '3000',
    WORKER_MODE: '0',
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    DATABASE_DIRECT_URL: 'postgres://u:p@h:5432/d',
    AMQP_URL: 'amqp://localhost',
    JWT_SECRET: 'a'.repeat(32),
    INTEGRATION_DB_KEY: Buffer.alloc(32).toString('base64'),
    R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET: 'bucket',
    R2_KEY_PREFIX: '',
  };

  it('accepts a valid env', () => {
    expect(() => validateEnv(base)).not.toThrow();
  });

  it('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects short JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects non-32-byte INTEGRATION_DB_KEY', () => {
    expect(() => validateEnv({ ...base, INTEGRATION_DB_KEY: 'aaa' })).toThrow(/INTEGRATION_DB_KEY/);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm test -- src/config/env.validation.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement env.validation.ts**

```ts
import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, MinLength, validateSync } from 'class-validator';

enum NodeEnv {
  development = 'development',
  test = 'test',
  production = 'production',
}

class EnvVars {
  @IsEnum(NodeEnv)
  NODE_ENV!: NodeEnv;

  @IsInt()
  PORT!: number;

  @IsOptional() @IsString()
  WORKER_MODE?: string;

  @IsString() @MinLength(1, { message: 'DATABASE_URL must be set' })
  DATABASE_URL!: string;

  @IsString() @MinLength(1, { message: 'DATABASE_DIRECT_URL must be set' })
  DATABASE_DIRECT_URL!: string;

  @IsString()
  AMQP_URL!: string;

  @IsString() @MinLength(32, { message: 'JWT_SECRET must be at least 32 chars' })
  JWT_SECRET!: string;

  @IsString()
  INTEGRATION_DB_KEY!: string;

  @IsUrl({ require_tld: false })
  R2_ENDPOINT!: string;

  @IsString()
  R2_ACCESS_KEY_ID!: string;

  @IsString()
  R2_SECRET_ACCESS_KEY!: string;

  @IsString()
  R2_BUCKET!: string;

  @IsString()
  R2_KEY_PREFIX!: string;
}

export function validateEnv(raw: Record<string, unknown>): EnvVars {
  const parsed = plainToInstance(
    EnvVars,
    { ...raw, PORT: Number(raw.PORT ?? 3000) },
    { enableImplicitConversion: true },
  );
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; '));
  }
  const keyBytes = Buffer.from(parsed.INTEGRATION_DB_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error('INTEGRATION_DB_KEY: must be 32 bytes (base64-encoded)');
  }
  return parsed;
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- src/config/env.validation.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: AppConfigService**

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string { return this.config.getOrThrow('NODE_ENV'); }
  get port(): number { return Number(this.config.getOrThrow('PORT')); }
  get isWorker(): boolean { return this.config.get('WORKER_MODE') === '1'; }
  get databaseUrl(): string { return this.config.getOrThrow('DATABASE_URL'); }
  get databaseDirectUrl(): string { return this.config.getOrThrow('DATABASE_DIRECT_URL'); }
  get amqpUrl(): string { return this.config.getOrThrow('AMQP_URL'); }
  get jwtSecret(): string { return this.config.getOrThrow('JWT_SECRET'); }
  get integrationDbKey(): Buffer { return Buffer.from(this.config.getOrThrow('INTEGRATION_DB_KEY'), 'base64'); }
  get r2(): { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string; keyPrefix: string } {
    return {
      endpoint: this.config.getOrThrow('R2_ENDPOINT'),
      accessKeyId: this.config.getOrThrow('R2_ACCESS_KEY_ID'),
      secretAccessKey: this.config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      bucket: this.config.getOrThrow('R2_BUCKET'),
      keyPrefix: this.config.get('R2_KEY_PREFIX') ?? '',
    };
  }
}
```

- [ ] **Step 6: ConfigModule wrapper**

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';
import { AppConfigService } from './app-config.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
```

- [ ] **Step 7: .env.example**

```dotenv
NODE_ENV=development
PORT=3000
WORKER_MODE=0
DATABASE_URL=postgres://app:app@localhost:5432/app
DATABASE_DIRECT_URL=postgres://app:app@localhost:5432/app
AMQP_URL=amqp://guest:guest@localhost:5672
JWT_SECRET=replace-me-with-at-least-32-characters
INTEGRATION_DB_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
R2_ENDPOINT=https://example.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=local
R2_SECRET_ACCESS_KEY=local
R2_BUCKET=farmacore-dev
R2_KEY_PREFIX=dev/
```

- [ ] **Step 8: Commit**

```bash
git add src/config/ .env.example
git commit -m "feat(config): validated env + typed AppConfigService"
```

---

### Task 4: Database module shell (TypeORM)

**Files:**
- Create: `src/database/database.module.ts`

- [ ] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: 'postgres',
        url: config.databaseUrl,
        ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
        entities: [],          // populated per-feature via TypeOrmModule.forFeature
        synchronize: false,
        autoLoadEntities: true,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

> Plan 01 extends this with the core entities and switches off `autoLoadEntities` once entities are listed explicitly.

- [ ] **Step 2: Commit**

```bash
git add src/database/
git commit -m "feat(db): TypeORM root module"
```

---

### Task 5: Health module (stub — fully fleshed out in plan 07)

**Files:**
- Create: `src/health/health.controller.ts`
- Create: `src/health/health.module.ts`
- Create: `src/health/health.controller.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok', async () => {
    const mod = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    const controller = mod.get(HealthController);
    expect(await controller.check()).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- src/health/health.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement controller**

```ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }
}
```

- [ ] **Step 4: Implement module**

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 5: Run, expect pass**

Run: `npm test -- src/health/health.controller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/health/
git commit -m "feat(health): /health endpoint (stub)"
```

---

### Task 6: Compose AppModule

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Replace content**

```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, HealthModule],
  providers: [
    { provide: APP_PIPE, useFactory: () => new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }) },
  ],
})
export class AppModule {}
```

> Plan 09 adds `PresentationModule` to the imports list.

- [ ] **Step 2: Commit**

```bash
git add src/app.module.ts
git commit -m "feat: compose AppModule"
```

---

### Task 7: Single entry point with WORKER_MODE switch

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Implement**

```ts
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const isWorker = process.env.WORKER_MODE === '1';
  const logger = new Logger('Bootstrap');

  if (isWorker) {
    // Worker role: no HTTP. The worker module (plan 04) registers RMQ consumers.
    // For now, plan 00 ships only AppModule; plan 04 adds WorkerModule + switches this import.
    const app = await NestFactory.createApplicationContext(AppModule);
    logger.log('Worker started (no consumers registered yet — added in plan 04)');
    const shutdown = async (): Promise<void> => { await app.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> Plan 04 updates this file to import `WorkerModule` for the worker role.
> Plan 09 adds `catchUnhandledSignals(app)` after construction.

- [ ] **Step 2: Update nest-cli.json entryFile**

Set `"entryFile": "main"` in `nest-cli.json`.

- [ ] **Step 3: Smoke test API**

```bash
npm run start:dev
# in another shell:
curl http://localhost:3000/health
# expect: {"status":"ok"}
```

Stop the dev server.

- [ ] **Step 4: Smoke test worker**

```bash
npm run build
WORKER_MODE=1 node dist/main.js
# expect log: "Worker started (no consumers registered yet — added in plan 04)"
# Ctrl+C exits cleanly
```

- [ ] **Step 5: Update scripts**

In `package.json`:

```json
"start": "nest start",
"start:dev": "nest start --watch",
"start:api": "node dist/main.js",
"start:worker": "WORKER_MODE=1 node dist/main.js"
```

- [ ] **Step 6: Commit**

```bash
git add src/main.ts nest-cli.json package.json
git commit -m "feat: single entry point with WORKER_MODE switch"
```

---

### Task 8: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Multi-stage Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --production

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
EXPOSE 3000
# Same image for API and worker; the worker Fly app sets WORKER_MODE=1.
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: .dockerignore**

```
node_modules
dist
.git
.env
.env.*
!.env.example
coverage
*.log
.DS_Store
```

- [ ] **Step 3: Build image locally**

Run: `docker build -t farmacore:dev .`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: multi-stage Dockerfile (single image for API + worker)"
```

---

### Task 9: docker-compose for local dev

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Compose file**

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    ports: ["5672:5672", "15672:15672"]
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest

volumes:
  pgdata:
```

- [ ] **Step 2: Bring up and verify**

```bash
docker compose up -d
sleep 5
docker compose ps
psql postgres://app:app@localhost:5432/app -c 'SELECT 1'
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: docker-compose for local postgres + rabbitmq"
```

---

### Task 10: README quickstart

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace contents**

```markdown
# Farmacore

Multi-tenant NestJS backend. See [`arc/`](./arc/) for architecture and [`plans/`](./plans/) for execution.

## Quickstart

```bash
npm install
cp .env.example .env
docker compose up -d        # postgres + rabbitmq
npm run start:dev           # API

# in another shell:
npm run build && WORKER_MODE=1 node dist/main.js   # worker
```

Health check: `curl http://localhost:3000/health`.

## Scripts

- `npm run start:dev` — API in watch mode
- `npm run build` — compile to `dist/`
- `npm test` — unit tests
- `node dist/main.js` — production API entry
- `WORKER_MODE=1 node dist/main.js` — production worker entry
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README quickstart"
```

---

## Exit Criteria

- [ ] `npm test` passes.
- [ ] `npm run start:dev` boots, `GET /health` returns 200.
- [ ] `WORKER_MODE=1 node dist/main.js` starts (no consumers yet) and exits cleanly on SIGTERM.
- [ ] `docker build` succeeds; container starts.
- [ ] `.env.example` documents every required var; `validateEnv` rejects missing/invalid ones.
- [ ] `docker compose up` brings up postgres + rabbitmq locally.
- [ ] **No pino, no winston, no third-party logger dep** — logging arrives in plan 09 via the internal logger abstraction.
- [ ] **Single `src/main.ts`** — no `main.api.ts` / `main.worker.ts`.
