# 06 — Admin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 06 was executed. `AdminModule` imports `PipelineStepsModule.forRoot({ withConsumers: false })` for `AdminPipelineService`. E2E tests run with `NODE_ENV=development` via `test/setup-e2e-env.ts` so the local broker queue topology matches.

**Goal:** Cross-cutting admin endpoints — tenant onboarding/offboarding, integration-connection management, competitor-origin toggles, DLQ inspection, and manual pipeline triggering. All admin endpoints require an `admin` role token issued for the **`system`** tenant.

**Architecture:** A single `AdminModule` mounts under `/admin`. A `SystemAdminGuard` rejects anything that isn't `tenantId === 'system' && role === 'admin'`. Tenant onboarding (`POST /admin/tenants`) is synchronous: it runs `CREATE SCHEMA tenant_<slug>` + tenant migrations + seeds the `tenant_competitor_origin` rows + creates an initial admin user, all inside one process. DLQ inspection uses `amqplib` directly (the management API would need extra credentials).

**Tech Stack:** NestJS controllers, `@Roles('admin')` + `SystemAdminGuard`, `amqplib` for DLQ reads.

**Reference:** `arc/03-auth-and-tenancy.md` §6, §7, §9; `arc/04-integration-data-source.md` §5; `arc/02-queue-and-routines.md` §5.

---

## Interfaces Exposed

- **Module:** `AdminModule`.
- **Guard:** `SystemAdminGuard` — extends `RolesGuard` semantics but additionally requires `tenantId === 'system'`.
- **HTTP endpoints (all auth-required, system-admin only):**
  - `POST   /admin/tenants` — create tenant. Body: `{ slug, name, adminEmail }`. Returns `{ slug, schemaName, initialAdminUser: { email, oneTimePassword } }`.
  - `GET    /admin/tenants` — list.
  - `GET    /admin/tenants/:slug` — show.
  - `PATCH  /admin/tenants/:slug/status` — change status. Body: `{ status: 'active'|'paused'|'suspended' }`.
  - `DELETE /admin/tenants/:slug` — soft-delete (sets suspended, schedules drop via R2 export — drop itself runs after 30 days; documented).
  - `PUT    /admin/tenants/:slug/integration` — upsert ERP connection (uses `IntegrationConnectionService`, plan 03).
  - `POST   /admin/tenants/:slug/integration/test` — test stored ERP connection.
  - `DELETE /admin/tenants/:slug/integration` — disable connection.
  - `PUT    /admin/tenants/:slug/competitor-origins` — bulk update enabled/priority/config.
  - `POST   /admin/tenants/:slug/pipeline:start` — manually trigger a pipeline.
  - `GET    /admin/dlq/:step` — list messages in `<step>.dlq` (paginated; no ack).
  - `POST   /admin/dlq/:step/replay` — pop messages from DLQ and republish to the main exchange.
- **DTOs:**
  - `CreateTenantDto { slug, name, adminEmail }`
  - `UpdateTenantStatusDto { status }`
  - `UpdateCompetitorOriginsDto { origins: Array<{ origin, enabled, priority?, config? }> }`
- **Services:**
  - `TenantOnboardingService.create(dto): Promise<OnboardingResult>`
  - `TenantOffboardingService.softDelete(slug): Promise<void>`
  - `CompetitorOriginAdminService.bulkUpdate(slug, origins)`
  - `DlqService.peek(step, limit)`, `DlqService.replay(step, max)`.

---

## File Structure

```
src/admin/
├─ admin.module.ts
├─ guards/
│  └─ system-admin.guard.ts
├─ controllers/
│  ├─ tenants.controller.ts
│  ├─ integration.controller.ts
│  ├─ competitor-origins.controller.ts
│  ├─ pipeline.controller.ts
│  └─ dlq.controller.ts
├─ services/
│  ├─ tenant-onboarding.service.ts
│  ├─ tenant-offboarding.service.ts
│  ├─ competitor-origin-admin.service.ts
│  └─ dlq.service.ts
└─ dto/
   ├─ create-tenant.dto.ts
   ├─ update-tenant-status.dto.ts
   └─ update-competitor-origins.dto.ts
```

---

### Task 1: SystemAdminGuard

**Files:** `src/admin/guards/system-admin.guard.ts`

- [x] **Step 1: Implement**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../../auth/jwt-payload.type';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (user.tenantId !== 'system' || user.role !== 'admin') {
      throw new ForbiddenException('System admin required');
    }
    return true;
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/guards/system-admin.guard.ts
git commit -m "feat(admin): SystemAdminGuard"
```

---

### Task 2: DTOs

**Files:** `src/admin/dto/`

- [x] **Step 1: create-tenant.dto.ts**

```ts
import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{2,31}$/, { message: 'slug must be lowercase kebab-case, 3-32 chars, starting with a letter' })
  slug!: string;

  @IsString() @Length(1, 200)
  name!: string;

  @IsEmail()
  adminEmail!: string;
}
```

- [x] **Step 2: update-tenant-status.dto.ts**

```ts
import { IsIn } from 'class-validator';
import { TenantStatus } from '../../database/enums/tenant-status.enum';

export class UpdateTenantStatusDto {
  @IsIn(Object.values(TenantStatus))
  status!: TenantStatus;
}
```

- [x] **Step 3: update-competitor-origins.dto.ts**

```ts
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, Min, ValidateNested } from 'class-validator';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';

export class CompetitorOriginUpdate {
  @IsEnum(CompetitorOrigin)
  origin!: CompetitorOrigin;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional() @IsInt() @Min(0)
  priority?: number;

  @IsOptional() @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateCompetitorOriginsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CompetitorOriginUpdate)
  origins!: CompetitorOriginUpdate[];
}
```

- [x] **Step 4: Commit**

```bash
git add src/admin/dto/
git commit -m "feat(admin): DTOs"
```

---

### Task 3: TenantOnboardingService

**Files:** `src/admin/services/tenant-onboarding.service.ts`

- [x] **Step 1: Implement**

```ts
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { UserEntity } from '../../database/entities/core/user.entity';
import { TenantStatus } from '../../database/enums/tenant-status.enum';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { PasswordService } from '../../auth/password.service';

const RESERVED = new Set(['admin', 'api', 'app', 'meta', 'shared', 'system', 'www']);

export interface OnboardingResult {
  slug: string;
  schemaName: string;
  initialAdminUser: { email: string; oneTimePassword: string };
}

@Injectable()
export class TenantOnboardingService {
  private readonly logger = new Logger(TenantOnboardingService.name);

  constructor(
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
  ) {}

  public async create(dto: CreateTenantDto): Promise<OnboardingResult> {
    if (RESERVED.has(dto.slug)) throw new BadRequestException(`slug "${dto.slug}" is reserved`);

    const existing = await this.tenants.findOne({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Tenant ${dto.slug} already exists`);

    const schemaName = `tenant_${dto.slug.replace(/-/g, '_')}`;

    // 1. Insert tenant row
    const tenant = await this.tenants.save({
      slug: dto.slug, name: dto.name, schemaName, status: TenantStatus.ACTIVE,
    });

    // 2. CREATE SCHEMA + tenant migrations (shell out — re-uses scripts/migrate-tenant.ts)
    try {
      await this.dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      execSync(`npm run migration:tenant ${dto.slug}`, { stdio: 'inherit' });
    } catch (err) {
      this.logger.error(`Tenant onboarding failed for ${dto.slug}: ${(err as Error).message}`);
      tenant.status = TenantStatus.SUSPENDED;
      await this.tenants.save(tenant);
      throw err;
    }

    // 3. Seed tenant_competitor_origin rows (all enabled=false initially)
    await this.dataSource.transaction(async (em) => {
      await em.query(`SET LOCAL search_path TO "${schemaName}", shared_catalog, public`);
      for (const origin of Object.values(CompetitorOrigin)) {
        await em.query(
          `INSERT INTO tenant_competitor_origin (origin, enabled) VALUES ($1, false)
           ON CONFLICT (origin) DO NOTHING`,
          [origin],
        );
      }
    });

    // 4. Create initial admin user with a one-time random password.
    const oneTimePassword = crypto.randomBytes(18).toString('base64url');
    const hash = await this.passwords.hash(oneTimePassword);
    await this.users.save({
      tenantId: dto.slug,
      email: dto.adminEmail,
      passwordHash: hash,
      role: 'admin',
      status: 'active',
    });

    return {
      slug: dto.slug,
      schemaName,
      initialAdminUser: { email: dto.adminEmail, oneTimePassword },
    };
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/services/tenant-onboarding.service.ts
git commit -m "feat(admin): TenantOnboardingService — schema + migrations + seed origins + admin user"
```

---

### Task 4: TenantOffboardingService

**Files:** `src/admin/services/tenant-offboarding.service.ts`

> **Scope:** The full 30-day grace + R2 dump is documented in `arc/03 §7`. For v1 the soft-delete is implemented in code; the **scheduled drop after 30 days** is a follow-up that lives outside this plan (Open Question, see end of file). Here we just set `status=suspended` and stamp `deleted_at`.

- [x] **Step 1: Implement**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { TenantStatus } from '../../database/enums/tenant-status.enum';

@Injectable()
export class TenantOffboardingService {
  constructor(
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
  ) {}

  public async softDelete(slug: string): Promise<void> {
    const tenant = await this.tenants.findOne({ where: { slug } });
    if (!tenant) throw new NotFoundException();
    tenant.status = TenantStatus.SUSPENDED;
    tenant.deletedAt = new Date();
    await this.tenants.save(tenant);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/services/tenant-offboarding.service.ts
git commit -m "feat(admin): TenantOffboardingService.softDelete"
```

---

### Task 5: CompetitorOriginAdminService

**Files:** `src/admin/services/competitor-origin-admin.service.ts`

- [x] **Step 1: Implement**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantService } from '../../tenant/tenant.service';
import { CompetitorOriginUpdate } from '../dto/update-competitor-origins.dto';

@Injectable()
export class CompetitorOriginAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenants: TenantService,
  ) {}

  public async bulkUpdate(slug: string, updates: CompetitorOriginUpdate[]): Promise<void> {
    const tenant = await this.tenants.findActive(slug);
    await this.dataSource.transaction(async (em) => {
      await em.query(`SET LOCAL search_path TO "${tenant.schemaName}", shared_catalog, public`);
      for (const u of updates) {
        await em.query(
          `UPDATE tenant_competitor_origin
             SET enabled = $1, priority = COALESCE($2, priority), config = COALESCE($3, config), updated_at = now()
           WHERE origin = $4`,
          [u.enabled, u.priority ?? null, u.config ? JSON.stringify(u.config) : null, u.origin],
        );
      }
    });
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/services/competitor-origin-admin.service.ts
git commit -m "feat(admin): CompetitorOriginAdminService.bulkUpdate"
```

---

### Task 6: DlqService

**Files:** `src/admin/services/dlq.service.ts`

DLQ peek uses a non-blocking `basicGet` loop with `requeue=true` so we don't consume the messages — only inspect. Replay uses `basicGet` with `requeue=false` + republish.

- [x] **Step 1: Implement**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, STEP_QUEUES } from '../../queue/constants';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

interface DlqMessage {
  routingKey: string;
  body: unknown;
  redelivered: boolean;
  headers: Record<string, unknown>;
}

@Injectable()
export class DlqService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async peek(step: PipelineStep, limit = 50): Promise<DlqMessage[]> {
    this.assertStep(step);
    const channel = this.amqp.channel;
    const out: DlqMessage[] = [];
    for (let i = 0; i < limit; i++) {
      const msg = await channel.get(`${step}.dlq`, { noAck: false });
      if (!msg) break;
      out.push({
        routingKey: msg.fields.routingKey,
        body: JSON.parse(msg.content.toString()),
        redelivered: msg.fields.redelivered,
        headers: (msg.properties.headers as Record<string, unknown>) ?? {},
      });
      // Requeue (peek doesn't consume): nack with requeue=true
      channel.nack(msg, false, true);
    }
    return out;
  }

  public async replay(step: PipelineStep, max = 100): Promise<{ replayed: number }> {
    this.assertStep(step);
    const channel = this.amqp.channel;
    let replayed = 0;
    for (let i = 0; i < max; i++) {
      const msg = await channel.get(`${step}.dlq`, { noAck: false });
      if (!msg) break;
      const body = JSON.parse(msg.content.toString());
      // Reset attempt so retries start fresh.
      const replayedBody = { ...body, attempt: 1 };
      await this.amqp.publish(EXCHANGE_NAME, msg.fields.routingKey, replayedBody, { persistent: true });
      channel.ack(msg);
      replayed++;
    }
    return { replayed };
  }

  private assertStep(step: PipelineStep): void {
    if (!STEP_QUEUES.includes(step)) throw new NotFoundException(`Unknown step ${step}`);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/services/dlq.service.ts
git commit -m "feat(admin): DlqService — peek + replay"
```

---

### Task 7: Tenants controller

**Files:** `src/admin/controllers/tenants.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { TenantOnboardingService, OnboardingResult } from '../services/tenant-onboarding.service';
import { TenantOffboardingService } from '../services/tenant-offboarding.service';
import { TenantService } from '../../tenant/tenant.service';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../dto/update-tenant-status.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { TenantEntity } from '../../database/entities/core/tenant.entity';
import { Repository } from 'typeorm';

@Controller('admin/tenants')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class TenantsController {
  constructor(
    private readonly onboarding: TenantOnboardingService,
    private readonly offboarding: TenantOffboardingService,
    private readonly tenants: TenantService,
    @InjectRepository(TenantEntity) private readonly repo: Repository<TenantEntity>,
  ) {}

  @Post()
  public create(@Body() dto: CreateTenantDto): Promise<OnboardingResult> {
    return this.onboarding.create(dto);
  }

  @Get()
  public list(): Promise<TenantEntity[]> {
    return this.repo.find({ order: { slug: 'ASC' } });
  }

  @Get(':slug')
  public show(@Param('slug') slug: string): Promise<TenantEntity> {
    return this.tenants.findBySlug(slug);
  }

  @Patch(':slug/status')
  public async updateStatus(@Param('slug') slug: string, @Body() dto: UpdateTenantStatusDto): Promise<void> {
    const t = await this.tenants.findBySlug(slug);
    t.status = dto.status;
    await this.repo.save(t);
  }

  @Delete(':slug')
  public softDelete(@Param('slug') slug: string): Promise<void> {
    return this.offboarding.softDelete(slug);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/controllers/tenants.controller.ts
git commit -m "feat(admin): tenants controller (CRUD)"
```

---

### Task 8: Integration controller

**Files:** `src/admin/controllers/integration.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Body, Controller, Delete, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { IntegrationConnectionService } from '../../integration/integration-connection.service';
import { UpsertIntegrationDto } from '../../integration/dto/upsert-integration.dto';

@Controller('admin/tenants/:slug/integration')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class IntegrationController {
  constructor(private readonly svc: IntegrationConnectionService) {}

  @Put()
  public async upsert(@Param('slug') slug: string, @Body() dto: UpsertIntegrationDto): Promise<{ status: string }> {
    const row = await this.svc.upsert(slug, dto);
    return { status: row.status };
  }

  @Post('test')
  public test(@Param('slug') slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.svc.test(slug);
  }

  @Delete()
  public disable(@Param('slug') slug: string): Promise<void> {
    return this.svc.disable(slug);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/controllers/integration.controller.ts
git commit -m "feat(admin): integration controller"
```

---

### Task 9: Competitor origins controller

**Files:** `src/admin/controllers/competitor-origins.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { CompetitorOriginAdminService } from '../services/competitor-origin-admin.service';
import { UpdateCompetitorOriginsDto } from '../dto/update-competitor-origins.dto';

@Controller('admin/tenants/:slug/competitor-origins')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class CompetitorOriginsController {
  constructor(private readonly svc: CompetitorOriginAdminService) {}

  @Put()
  public bulkUpdate(@Param('slug') slug: string, @Body() dto: UpdateCompetitorOriginsDto): Promise<void> {
    return this.svc.bulkUpdate(slug, dto.origins);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/controllers/competitor-origins.controller.ts
git commit -m "feat(admin): competitor origins bulk update"
```

---

### Task 10: Pipeline controller

**Files:** `src/admin/controllers/pipeline.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AdminPipelineService } from '../../pipeline/admin-pipeline.service';
import type { JwtPayload } from '../../auth/jwt-payload.type';

@Controller('admin/tenants/:slug/pipeline')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class PipelineController {
  constructor(private readonly svc: AdminPipelineService) {}

  @Post('start')
  public start(@Param('slug') slug: string, @CurrentUser() user: JwtPayload): Promise<{ pipelineRunId: string }> {
    return this.svc.startForTenant(slug, user.sub);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/controllers/pipeline.controller.ts
git commit -m "feat(admin): pipeline manual trigger"
```

---

### Task 11: DLQ controller

**Files:** `src/admin/controllers/dlq.controller.ts`

- [x] **Step 1: Implement**

```ts
import { Controller, DefaultValuePipe, Get, Param, ParseEnumPipe, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { SystemAdminGuard } from '../guards/system-admin.guard';
import { DlqService } from '../services/dlq.service';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

@Controller('admin/dlq')
@UseGuards(SystemAdminGuard)
@Roles('admin')
export class DlqController {
  constructor(private readonly svc: DlqService) {}

  @Get(':step')
  public peek(
    @Param('step', new ParseEnumPipe(PipelineStep)) step: PipelineStep,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.svc.peek(step, limit);
  }

  @Post(':step/replay')
  public replay(
    @Param('step', new ParseEnumPipe(PipelineStep)) step: PipelineStep,
    @Query('max', new DefaultValuePipe(100), ParseIntPipe) max: number,
  ) {
    return this.svc.replay(step, max);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/admin/controllers/dlq.controller.ts
git commit -m "feat(admin): DLQ peek + replay endpoints"
```

---

### Task 12: AdminModule

**Files:** `src/admin/admin.module.ts`

- [x] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { UserEntity } from '../database/entities/core/user.entity';
import { AuthModule } from '../auth/auth.module';
import { TenantOnboardingService } from './services/tenant-onboarding.service';
import { TenantOffboardingService } from './services/tenant-offboarding.service';
import { CompetitorOriginAdminService } from './services/competitor-origin-admin.service';
import { DlqService } from './services/dlq.service';
import { TenantsController } from './controllers/tenants.controller';
import { IntegrationController } from './controllers/integration.controller';
import { CompetitorOriginsController } from './controllers/competitor-origins.controller';
import { PipelineController } from './controllers/pipeline.controller';
import { DlqController } from './controllers/dlq.controller';
import { PipelineStepsModule } from '../pipeline/pipeline-steps.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity, UserEntity]),
    AuthModule,
    PipelineStepsModule.forRoot({ withConsumers: false }), // for AdminPipelineService
  ],
  controllers: [
    TenantsController, IntegrationController, CompetitorOriginsController,
    PipelineController, DlqController,
  ],
  providers: [
    TenantOnboardingService, TenantOffboardingService,
    CompetitorOriginAdminService, DlqService,
  ],
})
export class AdminModule {}
```

- [x] **Step 2: Add to AppModule**

Import `AdminModule` in `src/app.module.ts`.

> Note: `AppModule` already imports `PipelineStepsModule.forRoot({ withConsumers: false })` from plan 05; if so, you can drop the import here (Nest dedupes by module identity). If duplication causes issues, hoist `PipelineStepsModule` into a single import inside `AppModule` only.

- [x] **Step 3: Commit**

```bash
git add src/admin/admin.module.ts src/app.module.ts
git commit -m "feat(admin): AdminModule wired into AppModule"
```

---

### Task 13: E2E test — onboarding flow

**Files:** `test/admin-onboarding.e2e-spec.ts`

- [x] **Step 1: Test**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';

describe('Admin tenant onboarding (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);

    // Seed system admin
    const hash = await argon2.hash('s3cret-sysadmin-please-rotate');
    await ds.query(`
      INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
      VALUES ('system', 'sysadmin@local', $1, 'admin', 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [hash]);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'sysadmin@local', password: 's3cret-sysadmin-please-rotate', tenantSlug: 'system' })
      .expect(200);
    token = login.body.accessToken;
  });

  afterAll(async () => { await app.close(); });

  it('onboards a new tenant end-to-end', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/tenants')
      .set('Authorization', `Bearer ${token}`)
      .send({ slug: 'e2e-acme', name: 'E2E Acme', adminEmail: 'admin@e2e-acme.test' })
      .expect(201);

    expect(res.body.slug).toBe('e2e-acme');
    expect(res.body.schemaName).toBe('tenant_e2e_acme');
    expect(res.body.initialAdminUser.email).toBe('admin@e2e-acme.test');
    expect(res.body.initialAdminUser.oneTimePassword).toMatch(/^[A-Za-z0-9_-]+$/);

    // tenant_competitor_origin seeded
    const rows = await ds.query(`SET search_path TO tenant_e2e_acme; SELECT count(*)::int FROM tenant_competitor_origin`);
    expect(Number((rows[0] ?? rows)[0]?.count)).toBeGreaterThanOrEqual(5);
  });

  it('rejects non-system tenant tokens', async () => {
    // Seed acme tenant and a non-admin user; expect 403 from /admin/tenants.
    const hash = await argon2.hash('user-password-12-chars-or-more');
    await ds.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('acme', 'Acme', 'tenant_acme', 'active')
      ON CONFLICT (slug) DO NOTHING
    `);
    await ds.query(`
      INSERT INTO core."user" (tenant_id, email, password_hash, role, status)
      VALUES ('acme', 'u@acme.test', $1, 'admin', 'active')
      ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `, [hash]);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'u@acme.test', password: 'user-password-12-chars-or-more', tenantSlug: 'acme' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/admin/tenants')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
  });
});
```

- [x] **Step 2: Run**

```bash
docker compose up -d postgres rabbitmq
npm run migration:run:app
npm run test:e2e -- --testNamePattern='Admin'
```

Expected: 2 tests pass.

- [x] **Step 3: Commit**

```bash
git add test/admin-onboarding.e2e-spec.ts
git commit -m "test(admin): e2e — onboarding + non-system rejection"
```

---

## Exit Criteria

- [x] `POST /admin/tenants` creates tenant row + schema + tenant migrations + competitor-origin seed + admin user; returns the slug, schema name, and a one-time password for the new admin.
- [x] `SystemAdminGuard` rejects any token whose `tenantId !== 'system'` or `role !== 'admin'`.
- [x] `PUT /admin/tenants/:slug/integration` upserts encrypted credentials and invalidates the integration data-source cache.
- [x] `POST /admin/tenants/:slug/integration/test` runs `SELECT 1` against the ERP and persists `last_verified_at` or `last_error`.
- [x] `PUT /admin/tenants/:slug/competitor-origins` updates `tenant_competitor_origin` in the right tenant schema.
- [x] `POST /admin/tenants/:slug/pipeline:start` returns a `pipelineRunId` and an end-to-end run reaches `update-active-ingredient-mat` (verified via plan 05's smoke test).
- [x] `GET /admin/dlq/:step` returns DLQ messages without consuming them; `POST /admin/dlq/:step/replay` republishes with `attempt=1`.
- [x] All admin endpoints rejected from non-system tokens.

---

## Open Questions (deferred)

- **30-day grace + pg_dump to R2 for offboarding** (`arc/03 §7`). Implement as a separate scheduled job (`scripts/run-offboarding-sweeper.ts`) once an object-storage upload service is in place. Tracked outside this plan.
- **Replay safety**: at-least-once redelivery means replayed DLQ messages might run a step twice. The base consumer's idempotency check on `pipeline_run.status=completed` covers this; a manual replay of a *completed* step is a no-op.
