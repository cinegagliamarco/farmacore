# 01 — Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 01 was executed. Post-execution amendments: (1) `external_id` moved from `shared_catalog.product` to a new `tenant_base_product` table per the arc doc (commit `41b2c81`); (2) `pipeline_run.tenant_id` changed from `uuid` to `text` to match the message-carried slug (commit `3ce3c0a`).

**Goal:** Build the database layer — three Postgres schemas (`core`, `shared_catalog`, `tenant_<slug>`), all TypeORM entities, migrations, and a migration runner that targets per-tenant schemas.

**Architecture:** One Neon database, many schemas. Migrations are split into three sets: `migrations/core/`, `migrations/shared_catalog/`, and `migrations/tenant/` (templated, run per tenant by a runner script). Entities declare their schema explicitly for `core` and `shared_catalog`; tenant entities omit `schema` and resolve via `search_path` set at runtime (plan 02).

**Tech Stack:** TypeORM 0.3 migrations, `pg` driver, two TypeORM `DataSource` configs (pooled for app, direct for migrations + `CREATE SCHEMA`).

**Reference:** `arc/01-database-schema.md` in full.

---

## Interfaces Exposed

- **Schemas:** `core`, `shared_catalog`, `tenant_<slug>` (templated).
- **Entities** (paths inside `src/database/entities/`):
  - `core/tenant.entity.ts` → `TenantEntity`
  - `core/integration-database-connection.entity.ts` → `IntegrationDatabaseConnectionEntity` *(columns only — encryption logic lives in plan 03)*
  - `core/user.entity.ts` → `UserEntity` *(columns only — auth logic in plan 02)*
  - `core/refresh-token.entity.ts` → `RefreshTokenEntity`
  - `core/pipeline-run.entity.ts` → `PipelineRunEntity`
  - `shared-catalog/base-product.entity.ts` → `BaseProductEntity` (simplified)
  - `shared-catalog/product.entity.ts` → `ProductEntity` (scraped competitor product)
  - `shared-catalog/product-image.entity.ts` → `ProductImageEntity`
  - `shared-catalog/product-stock.entity.ts` → `ProductStockEntity`
  - `tenant/tenant-competitor-origin.entity.ts` → `TenantCompetitorOriginEntity`
  - `tenant/tenant-base-product.entity.ts` → `TenantBaseProductEntity` *(per-tenant ERP code for a shared base_product, keyed by EAN)*
  - `tenant/tenant-product-override.entity.ts` → `TenantProductOverrideEntity`
  - `tenant/active-ingredient.entity.ts` → `ActiveIngredientEntity`
  - `tenant/classification.entity.ts` → `ClassificationEntity`
  - `tenant/offer-book.entity.ts` → `OfferBookEntity`
  - `tenant/offer-book-info.entity.ts` → `OfferBookInfoEntity`
  - `tenant/offer-book-pricing-rule.entity.ts` → `OfferBookPricingRuleEntity`
  - `tenant/offer-book-price-lock.entity.ts` → `OfferBookPriceLockEntity`
  - `tenant/offer-book-rule.entity.ts` → `OfferBookRuleEntity`
  - `tenant/offer-book-rule-product.entity.ts` → `OfferBookRuleProductEntity`
  - `tenant/offer-book-rule-execution-report.entity.ts` → `OfferBookRuleExecutionReportEntity`
  - `tenant/offer-book-rule-execution-report-item.entity.ts` → `OfferBookRuleExecutionReportItemEntity`
  - `tenant/price-rounding-rule.entity.ts` → `PriceRoundingRuleEntity`
  - `tenant/price-rounding-decimal-range.entity.ts` → `PriceRoundingDecimalRangeEntity`
  - `tenant/scheduling.entity.ts` → `SchedulingEntity`
  - `tenant/status-settings.entity.ts` → `StatusSettingsEntity`
- **Base class:** `src/database/entities/base.entity.ts` → `BaseEntity` (id, createdAt, updatedAt, deletedAt).
- **Enums:**
  - `competitor-origin.enum.ts` → `CompetitorOrigin` (DROGAL, DROGASIL, PAGUE_MENOS, IKESAKI, MICHELASSI)
  - `tenant-status.enum.ts` → `TenantStatus` (active, paused, suspended)
  - `pipeline-step.enum.ts` → `PipelineStep` (8 steps; see plan 05)
  - `pipeline-run-status.enum.ts` → `PipelineRunStatus` (running, completed, failed)
- **Scripts:**
  - `npm run migration:generate <name> -- --schema=<schema>` — TypeORM generate
  - `npm run migration:run` — runs `core` and `shared_catalog` migrations
  - `npm run migration:tenant <slug>` — runs `tenant/` template migrations against `tenant_<slug>`
  - `npm run migration:tenant:all` — iterates active tenants and migrates each
  - `npm run tenant:create <slug>` — runs `CREATE SCHEMA tenant_<slug>` and applies tenant migrations

---

## File Structure

```
src/database/
├─ entities/
│  ├─ base.entity.ts
│  ├─ core/
│  │   ├─ tenant.entity.ts
│  │   ├─ integration-database-connection.entity.ts
│  │   ├─ user.entity.ts
│  │   ├─ refresh-token.entity.ts
│  │   └─ pipeline-run.entity.ts
│  ├─ shared-catalog/
│  │   ├─ base-product.entity.ts
│  │   ├─ product.entity.ts
│  │   ├─ product-image.entity.ts
│  │   └─ product-stock.entity.ts
│  └─ tenant/
│      ├─ tenant-competitor-origin.entity.ts
│      ├─ tenant-base-product.entity.ts
│      ├─ tenant-product-override.entity.ts
│      ├─ active-ingredient.entity.ts
│      ├─ classification.entity.ts
│      ├─ offer-book.entity.ts
│      ├─ offer-book-info.entity.ts
│      ├─ offer-book-pricing-rule.entity.ts
│      ├─ offer-book-price-lock.entity.ts
│      ├─ offer-book-rule.entity.ts
│      ├─ offer-book-rule-product.entity.ts
│      ├─ offer-book-rule-execution-report.entity.ts
│      ├─ offer-book-rule-execution-report-item.entity.ts
│      ├─ price-rounding-rule.entity.ts
│      ├─ price-rounding-decimal-range.entity.ts
│      ├─ scheduling.entity.ts
│      └─ status-settings.entity.ts
├─ enums/
│  ├─ competitor-origin.enum.ts
│  ├─ tenant-status.enum.ts
│  ├─ pipeline-step.enum.ts
│  └─ pipeline-run-status.enum.ts
├─ data-source.ts                    # CLI DataSource for migrations
└─ database.module.ts                # already created in plan 00 — extended here

migrations/
├─ core/
│  └─ 1700000000000-init-core.ts
├─ shared_catalog/
│  └─ 1700000000001-init-shared-catalog.ts
└─ tenant/
   └─ 1700000000002-init-tenant.ts   # templated; runner substitutes the schema

scripts/
├─ migrate-app.ts                    # runs core + shared_catalog
├─ migrate-tenant.ts                 # runs tenant migrations against ONE tenant
├─ migrate-all-tenants.ts            # iterates tenants
└─ create-tenant-schema.ts           # CREATE SCHEMA + initial migrations
```

---

### Task 1: Add migration scripts to package.json

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add scripts**

```json
"migration:generate": "typeorm-ts-node-commonjs migration:generate -d src/database/data-source.ts",
"migration:create": "typeorm-ts-node-commonjs migration:create",
"migration:run:app": "ts-node scripts/migrate-app.ts",
"migration:revert:app": "typeorm-ts-node-commonjs migration:revert -d src/database/data-source.ts",
"migration:tenant": "ts-node scripts/migrate-tenant.ts",
"migration:tenant:all": "ts-node scripts/migrate-all-tenants.ts",
"tenant:create": "ts-node scripts/create-tenant-schema.ts"
```

- [x] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add migration scripts"
```

---

### Task 2: BaseEntity

**Files:**
- Create: `src/database/entities/base.entity.ts`

- [x] **Step 1: Implement**

```ts
import { CreateDateColumn, DeleteDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  public deletedAt?: Date | null;
}
```

- [x] **Step 2: Commit**

```bash
git add src/database/entities/base.entity.ts
git commit -m "feat(db): base entity with timestamps and soft delete"
```

---

### Task 3: Enums

**Files:**
- Create: all four files under `src/database/enums/`

- [x] **Step 1: competitor-origin.enum.ts**

```ts
export enum CompetitorOrigin {
  DROGAL = 'DROGAL',
  DROGASIL = 'DROGASIL',
  PAGUE_MENOS = 'PAGUE_MENOS',
  IKESAKI = 'IKESAKI',
  MICHELASSI = 'MICHELASSI',
}
```

- [x] **Step 2: tenant-status.enum.ts**

```ts
export enum TenantStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  SUSPENDED = 'suspended',
}
```

- [x] **Step 3: pipeline-step.enum.ts**

```ts
export enum PipelineStep {
  SYNC_BASE_PRODUCT = 'sync-base-product',
  SYNC_BASE_PRODUCT_STOCK = 'sync-base-product-stock',
  SYNC_OFFER_BOOKS_INFO = 'sync-offer-books-info',
  IMPORT_COMPETITOR_PRODUCTS = 'import-competitor-products',
  IMPORT_COMPETITOR_STOCK = 'import-competitor-stock',
  CALC_BASE_PRODUCT_METRICS = 'calc-base-product-metrics',
  UPDATE_BASE_PRODUCT_PROPERTIES = 'update-base-product-properties',
  UPDATE_ACTIVE_INGREDIENT_MAT = 'update-active-ingredient-mat',
}
```

- [x] **Step 4: pipeline-run-status.enum.ts**

```ts
export enum PipelineRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
```

- [x] **Step 5: Commit**

```bash
git add src/database/enums/
git commit -m "feat(db): shared enums"
```

---

### Task 4: core entities

**Files:** all under `src/database/entities/core/`

- [x] **Step 1: tenant.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantStatus } from '../../enums/tenant-status.enum';

@Entity({ schema: 'core', name: 'tenant' })
@Index('UQ_TENANT_SLUG', ['slug'], { unique: true })
@Index('UQ_TENANT_SCHEMA_NAME', ['schemaName'], { unique: true })
export class TenantEntity extends BaseEntity {
  @Column({ type: 'text' })
  public slug!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', name: 'schema_name' })
  public schemaName!: string;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.ACTIVE })
  public status!: TenantStatus;
}
```

- [x] **Step 2: integration-database-connection.entity.ts**

```ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';

export type IntegrationDbType = 'postgres';
export type SslMode = 'disable' | 'require' | 'verify-full';
export type IntegrationStatus = 'active' | 'disabled' | 'error';

@Entity({ schema: 'core', name: 'integration_database_connection' })
@Index('UQ_INTEGRATION_DB_TENANT', ['tenantId'], { unique: true })
export class IntegrationDatabaseConnectionEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ManyToOne(() => TenantEntity)
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', default: 'postgres' })
  public type!: IntegrationDbType;

  @Column({ type: 'text' })
  public host!: string;

  @Column({ type: 'int' })
  public port!: number;

  @Column({ type: 'text' })
  public database!: string;

  @Column({ type: 'text' })
  public username!: string;

  @Column({ name: 'password_encrypted', type: 'bytea' })
  public passwordEncrypted!: Buffer;

  @Column({ name: 'ssl_mode', type: 'text', default: 'require' })
  public sslMode!: SslMode;

  @Column({ name: 'ssl_ca_cert', type: 'text', nullable: true })
  public sslCaCert?: string | null;

  @Column({ name: 'read_only', type: 'boolean', default: true })
  public readOnly!: boolean;

  @Column({ name: 'connection_options', type: 'jsonb', default: {} })
  public connectionOptions!: Record<string, unknown>;

  @Column({ type: 'text', default: 'active' })
  public status!: IntegrationStatus;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  public lastVerifiedAt?: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  public lastError?: string | null;
}
```

- [x] **Step 3: user.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

export type UserRole = 'admin' | 'operator' | 'viewer';
export type UserStatus = 'active' | 'disabled';

@Entity({ schema: 'core', name: 'user' })
@Index('UQ_USER_TENANT_EMAIL', ['tenantId', 'email'], { unique: true })
export class UserEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  // citext column declared in migration; class type stays string
  @Column({ type: 'text' })
  public email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  public passwordHash!: string;

  @Column({ type: 'text', default: 'viewer' })
  public role!: UserRole;

  @Column({ type: 'text', default: 'active' })
  public status!: UserStatus;
}
```

- [x] **Step 4: refresh-token.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'core', name: 'refresh_token' })
@Index('IX_REFRESH_TOKEN_USER', ['userId'])
export class RefreshTokenEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  public userId!: string;

  @Column({ name: 'token_hash', type: 'text' })
  public tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  public expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  public revokedAt?: Date | null;
}
```

- [x] **Step 5: pipeline-run.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PipelineStep } from '../../enums/pipeline-step.enum';
import { PipelineRunStatus } from '../../enums/pipeline-run-status.enum';

@Entity({ schema: 'core', name: 'pipeline_run' })
@Index('IX_PIPELINE_RUN_TENANT_STEP_STARTED', ['tenantId', 'step', 'startedAt'])
@Index('UQ_PIPELINE_RUN_RUN_STEP', ['pipelineRunId', 'step'], { unique: true })
export class PipelineRunEntity extends BaseEntity {
  @Column({ name: 'pipeline_run_id', type: 'uuid' })
  public pipelineRunId!: string;

  @Column({ name: 'tenant_id', type: 'text' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public step!: PipelineStep;

  @Column({ type: 'text' })
  public status!: PipelineRunStatus;

  @Column({ type: 'int', default: 1 })
  public attempt!: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  public finishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  public error?: string | null;
}
```

- [x] **Step 6: Commit**

```bash
git add src/database/entities/core/
git commit -m "feat(db): core entities"
```

---

### Task 5: shared_catalog entities

**Files:** all under `src/database/entities/shared-catalog/`

- [x] **Step 1: base-product.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'shared_catalog', name: 'base_product' })
@Index('UQ_BASE_PRODUCT_EAN', ['ean'], { unique: true })
export class BaseProductEntity extends BaseEntity {
  @Column({ type: 'bigint', unique: true })
  public ean!: string;          // bigint serialized as string in pg driver

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'active_ingredient', type: 'text', nullable: true })
  public activeIngredient?: string | null;

  @Column({ type: 'boolean', default: false })
  public generic!: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public height?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public length?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public width?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  public weight?: string | null;
}
```

- [x] **Step 2: product.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ schema: 'shared_catalog', name: 'product' })
@Index('IX_PRODUCT_EAN_ORIGIN', ['ean', 'origin'])
export class ProductEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'text', nullable: true })
  public name?: string | null;

  @Column({ type: 'text', nullable: true })
  public url?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  public price?: string | null;

  @Column({ name: 'unit_sale_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public unitSalePrice?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public metadata!: Record<string, unknown>;
}
```

- [x] **Step 3: product-image.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'shared_catalog', name: 'product_image' })
@Index('IX_PRODUCT_IMAGE_PRODUCT', ['productId'])
export class ProductImageEntity extends BaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  public productId!: string;

  @Column({ type: 'text' })
  public url!: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;
}
```

- [x] **Step 4: product-stock.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'shared_catalog', name: 'product_stock' })
@Index('IX_PRODUCT_STOCK_PRODUCT_CAPTURED', ['productId', 'capturedAt'])
export class ProductStockEntity extends BaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  public productId!: string;

  @Column({ type: 'int' })
  public quantity!: number;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  public capturedAt!: Date;
}
```

- [x] **Step 5: Commit**

```bash
git add src/database/entities/shared-catalog/
git commit -m "feat(db): shared_catalog entities (base_product simplified, product/image/stock)"
```

---

### Task 6: tenant entities (config + overrides)

**Files:** `src/database/entities/tenant/tenant-competitor-origin.entity.ts`, `tenant-base-product.entity.ts`, `tenant-product-override.entity.ts`

- [x] **Step 1: tenant-competitor-origin.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ name: 'tenant_competitor_origin' }) // schema resolved via search_path
@Index('UQ_TENANT_COMP_ORIGIN', ['origin'], { unique: true })
export class TenantCompetitorOriginEntity extends BaseEntity {
  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;

  @Column({ type: 'jsonb', default: {} })
  public config!: Record<string, unknown>;
}
```

- [x] **Step 2: tenant-base-product.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

// Tenant-side view of a shared `shared_catalog.base_product`. Holds ERP-only
// fields that don't belong in the shared catalog — most notably `external_id`,
// each tenant's ERP/POS code for the canonical EAN. One row per EAN per tenant.
@Entity({ name: 'tenant_base_product' })
@Index('UQ_TENANT_BASE_PRODUCT_EAN', ['ean'], { unique: true })
@Index('UQ_TENANT_BASE_PRODUCT_EXTERNAL_ID', ['externalId'], { unique: true, where: '"external_id" IS NOT NULL' })
export class TenantBaseProductEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'external_id', type: 'text', nullable: true })
  public externalId?: string | null;
}
```

- [x] **Step 3: tenant-product-override.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ name: 'tenant_product_override' })
@Index('UQ_TENANT_OVERRIDE_EAN_ORIGIN', ['ean', 'origin'], { unique: true })
@Index('IX_TENANT_OVERRIDE_EAN', ['ean'])
export class TenantProductOverrideEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'boolean', default: false })
  public monitored!: boolean;

  @Column({ type: 'text', nullable: true })
  public notes?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public overrides!: Record<string, unknown>;
}
```

- [x] **Step 4: Commit**

```bash
git add src/database/entities/tenant/tenant-competitor-origin.entity.ts \
        src/database/entities/tenant/tenant-base-product.entity.ts \
        src/database/entities/tenant/tenant-product-override.entity.ts
git commit -m "feat(db): tenant origin config + base-product + product override entities"
```

---

### Task 7: tenant entities (curated taxonomy)

**Files:** `src/database/entities/tenant/active-ingredient.entity.ts`, `classification.entity.ts`

- [x] **Step 1: active-ingredient.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'active_ingredient' })
@Index('UQ_ACTIVE_INGREDIENT_NAME', ['name'], { unique: true })
export class ActiveIngredientEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'numeric', precision: 12, scale: 4, nullable: true })
  public mat?: string | null;

  @Column({ name: 'mat_updated_at', type: 'timestamptz', nullable: true })
  public matUpdatedAt?: Date | null;
}
```

- [x] **Step 2: classification.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'classification' })
@Index('IX_CLASSIFICATION_PARENT', ['parentId'])
export class ClassificationEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  public parentId?: string | null;

  @Column({ type: 'boolean', default: true })
  public visible!: boolean;
}
```

- [x] **Step 3: Commit**

```bash
git add src/database/entities/tenant/active-ingredient.entity.ts \
        src/database/entities/tenant/classification.entity.ts
git commit -m "feat(db): tenant taxonomy entities"
```

---

### Task 8: tenant entities (offer book)

**Files:** `offer-book.entity.ts`, `offer-book-info.entity.ts`, `offer-book-pricing-rule.entity.ts`, `offer-book-price-lock.entity.ts`, `offer-book-rule.entity.ts`, `offer-book-rule-product.entity.ts`, `offer-book-rule-execution-report.entity.ts`, `offer-book-rule-execution-report-item.entity.ts`

- [x] **Step 1: offer-book.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book' })
@Index('UQ_OFFER_BOOK_EAN', ['ean'], { unique: true })
export class OfferBookEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'target_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public targetPrice?: string | null;
}
```

- [x] **Step 2: offer-book-info.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_info' })
@Index('UQ_OFFER_BOOK_INFO_BOOK', ['offerBookId'], { unique: true })
export class OfferBookInfoEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ type: 'jsonb', default: {} })
  public data!: Record<string, unknown>;
}
```

- [x] **Step 3: offer-book-pricing-rule.entity.ts**

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_pricing_rule' })
export class OfferBookPricingRuleEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ type: 'text' })
  public expression!: string; // arithmetic / comparison expr; keep flexible

  @Column({ type: 'int', default: 100 })
  public priority!: number;
}
```

- [x] **Step 4: offer-book-price-lock.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_price_lock' })
@Index('UQ_PRICE_LOCK_BOOK', ['offerBookId'], { unique: true })
export class OfferBookPriceLockEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ name: 'locked_price', type: 'numeric', precision: 12, scale: 2 })
  public lockedPrice!: string;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  public lockedUntil?: Date | null;
}
```

- [x] **Step 5: offer-book-rule.entity.ts**

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule' })
export class OfferBookRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public conditions!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;
}
```

- [x] **Step 6: offer-book-rule-product.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule_product' })
@Index('UQ_RULE_PRODUCT', ['ruleId', 'ean'], { unique: true })
export class OfferBookRuleProductEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;
}
```

- [x] **Step 7: offer-book-rule-execution-report.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule_execution_report' })
@Index('IX_REPORT_RULE_STARTED', ['ruleId', 'startedAt'])
export class OfferBookRuleExecutionReportEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  public finishedAt?: Date | null;

  @Column({ type: 'text' })
  public status!: 'running' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  public error?: string | null;
}
```

- [x] **Step 8: offer-book-rule-execution-report-item.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule_execution_report_item' })
@Index('IX_REPORT_ITEM_REPORT', ['reportId'])
export class OfferBookRuleExecutionReportItemEntity extends BaseEntity {
  @Column({ name: 'report_id', type: 'uuid' })
  public reportId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'old_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public oldPrice?: string | null;

  @Column({ name: 'new_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public newPrice?: string | null;

  @Column({ type: 'text', nullable: true })
  public outcome?: string | null;
}
```

- [x] **Step 9: Commit**

```bash
git add src/database/entities/tenant/offer-book*.entity.ts
git commit -m "feat(db): tenant offer-book entities"
```

---

### Task 9: tenant entities (pricing rounding, scheduling, status)

**Files:** `price-rounding-rule.entity.ts`, `price-rounding-decimal-range.entity.ts`, `scheduling.entity.ts`, `status-settings.entity.ts`

- [x] **Step 1: price-rounding-rule.entity.ts**

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'price_rounding_rule' })
export class PriceRoundingRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;
}
```

- [x] **Step 2: price-rounding-decimal-range.entity.ts**

```ts
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'price_rounding_decimal_range' })
@Index('IX_DECIMAL_RANGE_RULE', ['ruleId'])
export class PriceRoundingDecimalRangeEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'min_decimal', type: 'numeric', precision: 5, scale: 2 })
  public minDecimal!: string;

  @Column({ name: 'max_decimal', type: 'numeric', precision: 5, scale: 2 })
  public maxDecimal!: string;

  @Column({ name: 'target_decimal', type: 'numeric', precision: 5, scale: 2 })
  public targetDecimal!: string;
}
```

- [x] **Step 3: scheduling.entity.ts**

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'scheduling' })
export class SchedulingEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ name: 'cron_expression', type: 'text' })
  public cronExpression!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'jsonb', default: {} })
  public payload!: Record<string, unknown>;
}
```

- [x] **Step 4: status-settings.entity.ts**

```ts
import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'status_settings' })
export class StatusSettingsEntity extends BaseEntity {
  @Column({ type: 'jsonb', default: {} })
  public settings!: Record<string, unknown>;
}
```

- [x] **Step 5: Commit**

```bash
git add src/database/entities/tenant/price-rounding*.entity.ts \
        src/database/entities/tenant/scheduling.entity.ts \
        src/database/entities/tenant/status-settings.entity.ts
git commit -m "feat(db): tenant rounding + scheduling + status entities"
```

---

### Task 10: CLI DataSource for migrations

**Files:** `src/database/data-source.ts`

- [x] **Step 1: Implement**

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';

// Direct URL (non-pooled) is required for DDL and migrations against Neon.
const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

export default new DataSource({
  type: 'postgres',
  url,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  entities: ['src/database/entities/**/*.entity.ts'],
  migrations: ['migrations/core/*.ts', 'migrations/shared_catalog/*.ts'],
  migrationsTableName: 'migrations_app',
});
```

- [x] **Step 2: Commit**

```bash
git add src/database/data-source.ts
git commit -m "feat(db): CLI DataSource for migrations"
```

---

### Task 11: Initial core migration

**Files:** `migrations/core/1700000000000-init-core.ts`

- [x] **Step 1: Implement**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAppMeta1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS core`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);

    await queryRunner.query(`
      CREATE TABLE core.tenant (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        slug text NOT NULL,
        name text NOT NULL,
        schema_name text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_tenant_status CHECK (status IN ('active','paused','suspended'))
      );
      CREATE UNIQUE INDEX "UQ_TENANT_SLUG" ON core.tenant(slug);
      CREATE UNIQUE INDEX "UQ_TENANT_SCHEMA_NAME" ON core.tenant(schema_name);
    `);

    await queryRunner.query(`
      CREATE TABLE core.integration_database_connection (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        name text NOT NULL,
        type text NOT NULL DEFAULT 'postgres',
        host text NOT NULL,
        port int NOT NULL,
        database text NOT NULL,
        username text NOT NULL,
        password_encrypted bytea NOT NULL,
        ssl_mode text NOT NULL DEFAULT 'require',
        ssl_ca_cert text,
        read_only boolean NOT NULL DEFAULT true,
        connection_options jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'active',
        last_verified_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_INTEGRATION_DB_TENANT" ON core.integration_database_connection(tenant_id);
    `);

    await queryRunner.query(`
      CREATE TABLE core."user" (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id text NOT NULL,
        email citext NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'viewer',
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_user_role CHECK (role IN ('admin','operator','viewer')),
        CONSTRAINT chk_user_status CHECK (status IN ('active','disabled'))
      );
      CREATE UNIQUE INDEX "UQ_USER_TENANT_EMAIL" ON core."user"(tenant_id, email);
    `);

    await queryRunner.query(`
      CREATE TABLE core.refresh_token (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id uuid NOT NULL REFERENCES core."user"(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_REFRESH_TOKEN_USER" ON core.refresh_token(user_id);
    `);

    await queryRunner.query(`
      CREATE TABLE core.pipeline_run (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        pipeline_run_id uuid NOT NULL,
        tenant_id text NOT NULL,
        step text NOT NULL,
        status text NOT NULL,
        attempt int NOT NULL DEFAULT 1,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_pipeline_run_status CHECK (status IN ('running','completed','failed'))
      );
      CREATE INDEX "IX_PIPELINE_RUN_TENANT_STEP_STARTED" ON core.pipeline_run(tenant_id, step, started_at);
      CREATE UNIQUE INDEX "UQ_PIPELINE_RUN_RUN_STEP" ON core.pipeline_run(pipeline_run_id, step);
    `);

    // Seed the reserved "system" tenant. Schema name kept distinct so it never collides with a tenant_<slug>.
    await queryRunner.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ('system', 'System', 'system', 'active')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS core CASCADE`);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add migrations/core/
git commit -m "feat(db): initial core migration"
```

---

### Task 12: Initial shared_catalog migration

**Files:** `migrations/shared_catalog/1700000000001-init-shared-catalog.ts`

- [x] **Step 1: Implement**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSharedCatalog1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS shared_catalog`);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.base_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        description text,
        active_ingredient text,
        generic boolean NOT NULL DEFAULT false,
        height numeric(10,4),
        length numeric(10,4),
        width numeric(10,4),
        weight numeric(10,3),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_BASE_PRODUCT_EAN" ON shared_catalog.base_product(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        origin text NOT NULL,
        name text,
        url text,
        price numeric(12,2),
        unit_sale_price numeric(12,2),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_product_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE INDEX "IX_PRODUCT_EAN_ORIGIN" ON shared_catalog.product(ean, origin);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product_image (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES shared_catalog.product(id) ON DELETE CASCADE,
        url text NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRODUCT_IMAGE_PRODUCT" ON shared_catalog.product_image(product_id);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product_stock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES shared_catalog.product(id) ON DELETE CASCADE,
        quantity int NOT NULL,
        captured_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRODUCT_STOCK_PRODUCT_CAPTURED" ON shared_catalog.product_stock(product_id, captured_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS shared_catalog CASCADE`);
  }
}
```

- [x] **Step 2: Commit**

```bash
git add migrations/shared_catalog/
git commit -m "feat(db): initial shared_catalog migration"
```

---

### Task 13: Tenant template migration

**Files:** `migrations/tenant/1700000000002-init-tenant.ts`

This migration is **templated** — the runner sets `search_path = <tenant_schema>` before applying it, so all unqualified table names land in the right schema.

- [x] **Step 1: Implement**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTenant1700000000002 implements MigrationInterface {
  public name = 'InitTenant1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // search_path is set by the runner before this migration runs.
    await queryRunner.query(`
      CREATE TABLE tenant_competitor_origin (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        origin text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_tco_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE UNIQUE INDEX "UQ_TENANT_COMP_ORIGIN" ON tenant_competitor_origin(origin);
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_base_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        external_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_BASE_PRODUCT_EAN" ON tenant_base_product(ean);
      CREATE UNIQUE INDEX "UQ_TENANT_BASE_PRODUCT_EXTERNAL_ID"
        ON tenant_base_product(external_id) WHERE external_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_product_override (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        origin text NOT NULL,
        monitored boolean NOT NULL DEFAULT false,
        notes text,
        overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_OVERRIDE_EAN_ORIGIN" ON tenant_product_override(ean, origin);
      CREATE INDEX "IX_TENANT_OVERRIDE_EAN" ON tenant_product_override(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE active_ingredient (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        mat numeric(12,4),
        mat_updated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_ACTIVE_INGREDIENT_NAME" ON active_ingredient(name);
    `);

    await queryRunner.query(`
      CREATE TABLE classification (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        parent_id uuid,
        visible boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_CLASSIFICATION_PARENT" ON classification(parent_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        description text,
        target_price numeric(12,2),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_OFFER_BOOK_EAN" ON offer_book(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_info (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_OFFER_BOOK_INFO_BOOK" ON offer_book_info(offer_book_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_pricing_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        expression text NOT NULL,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_price_lock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        locked_price numeric(12,2) NOT NULL,
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_PRICE_LOCK_BOOK" ON offer_book_price_lock(offer_book_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text,
        conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_RULE_PRODUCT" ON offer_book_rule_product(rule_id, ean);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_execution_report (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        status text NOT NULL,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_report_status CHECK (status IN ('running','completed','failed'))
      );
      CREATE INDEX "IX_REPORT_RULE_STARTED" ON offer_book_rule_execution_report(rule_id, started_at);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_execution_report_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_id uuid NOT NULL REFERENCES offer_book_rule_execution_report(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        old_price numeric(12,2),
        new_price numeric(12,2),
        outcome text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_REPORT_ITEM_REPORT" ON offer_book_rule_execution_report_item(report_id);
    `);

    await queryRunner.query(`
      CREATE TABLE price_rounding_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE price_rounding_decimal_range (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES price_rounding_rule(id) ON DELETE CASCADE,
        min_decimal numeric(5,2) NOT NULL,
        max_decimal numeric(5,2) NOT NULL,
        target_decimal numeric(5,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_DECIMAL_RANGE_RULE" ON price_rounding_decimal_range(rule_id);
    `);

    await queryRunner.query(`
      CREATE TABLE scheduling (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        cron_expression text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE status_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Tenant down-migration is dangerous (drops tenant data). Tenant offboarding flow drops the schema instead.
    throw new Error('Tenant template migrations are not reversible. Use tenant offboarding to drop the schema.');
  }
}
```

- [x] **Step 2: Commit**

```bash
git add migrations/tenant/
git commit -m "feat(db): initial tenant template migration"
```

---

### Task 14: migrate-app script

**Files:** `scripts/migrate-app.ts`

- [x] **Step 1: Implement**

```ts
import dataSource from '../src/database/data-source';

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const result = await dataSource.runMigrations({ transaction: 'each' });
    console.log(`Applied ${result.length} migration(s):`);
    for (const m of result) console.log('  -', m.name);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [x] **Step 2: Run it**

Run: `npm run migration:run:app`
Expected: schemas + extensions created; 2 migrations applied; reserved `system` tenant inserted.

Verify in psql:
```sql
SELECT slug FROM core.tenant;
-- expect: system
\dn
-- expect schemas: core, shared_catalog, public
```

- [x] **Step 3: Commit**

```bash
git add scripts/migrate-app.ts
git commit -m "feat(db): migrate-app script"
```

---

### Task 15: migrate-tenant script (one tenant)

**Files:** `scripts/migrate-tenant.ts`

- [x] **Step 1: Implement**

```ts
import 'dotenv/config';
import * as path from 'path';
import { DataSource } from 'typeorm';

async function migrateOne(slug: string): Promise<void> {
  const schemaName = slug === 'system' ? 'system' : `tenant_${slug}`;
  const directUrl = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!directUrl) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  // A separate DataSource per tenant — sets search_path on connection.
  const ds = new DataSource({
    type: 'postgres',
    url: directUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    schema: schemaName,                              // sets default search_path on connect
    entities: [],
    migrations: [path.resolve(__dirname, '../migrations/tenant/*.{ts,js}')],
    migrationsTableName: 'migrations_tenant',
  });

  await ds.initialize();
  try {
    const queryRunner = ds.createQueryRunner();
    await queryRunner.query(`SET search_path TO "${schemaName}", shared_catalog, public`);
    await queryRunner.release();

    const applied = await ds.runMigrations({ transaction: 'each' });
    console.log(`[${slug}] applied ${applied.length} migration(s)`);
    // TypeORM persists applied migrations in the schema-scoped `migrations_tenant` table — no extra audit needed.
  } finally {
    await ds.destroy();
  }
}

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: npm run migration:tenant <slug>');
  process.exit(1);
}
migrateOne(slug).catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 2: Commit**

```bash
git add scripts/migrate-tenant.ts
git commit -m "feat(db): migrate-tenant script (one tenant)"
```

---

### Task 16: create-tenant-schema script

**Files:** `scripts/create-tenant-schema.ts`

- [x] **Step 1: Implement**

```ts
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
    throw new Error(`Invalid slug "${slug}". Must match ${SLUG_RE} and not be reserved (${[...RESERVED].join(', ')}).`);
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
    await ds.query(`
      INSERT INTO core.tenant (slug, name, schema_name, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (slug) DO NOTHING
    `, [slug, slug, schemaName]);
    console.log(`Schema ${schemaName} created; tenant row inserted (or already existed).`);
  } finally {
    await ds.destroy();
  }

  // Apply tenant template migrations
  execSync(`npm run migration:tenant ${slug}`, { stdio: 'inherit' });
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 2: Test against local docker compose**

```bash
docker compose up -d postgres
npm run migration:run:app
npm run tenant:create acme
psql postgres://app:app@localhost:5432/app -c "SET search_path TO tenant_acme; \dt"
# expect to see tenant tables
```

- [x] **Step 3: Commit**

```bash
git add scripts/create-tenant-schema.ts
git commit -m "feat(db): tenant:create script — provisions schema + migrations"
```

---

### Task 17: migrate-all-tenants script

**Files:** `scripts/migrate-all-tenants.ts`

- [x] **Step 1: Implement**

```ts
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { execSync } from 'node:child_process';

async function main(): Promise<void> {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be set');

  const ds = new DataSource({
    type: 'postgres', url,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    entities: [], synchronize: false,
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

  // Concurrency cap = 10 (arc/02 §8)
  const CONCURRENCY = 10;
  let cursor = 0;
  const failures: Array<{ slug: string; error: string }> = [];

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= tenants.length) return;
      const slug = tenants[i].slug;
      try {
        execSync(`npm run migration:tenant ${slug}`, { stdio: 'inherit' });
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

main().catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 2: Commit**

```bash
git add scripts/migrate-all-tenants.ts
git commit -m "feat(db): migrate-all-tenants with concurrency cap"
```

---

### Task 18: End-to-end smoke test

- [x] **Step 1: Clean local DB**

```bash
docker compose down -v && docker compose up -d postgres
sleep 3
```

- [x] **Step 2: Apply migrations**

```bash
npm run migration:run:app
npm run tenant:create acme
npm run tenant:create brand-x
npm run migration:tenant:all
```

- [x] **Step 3: Verify cross-schema join works**

```bash
psql postgres://app:app@localhost:5432/app <<'SQL'
SET search_path TO tenant_acme, shared_catalog, public;
-- Insert sample data
INSERT INTO shared_catalog.base_product (ean, description) VALUES (7891234567890, 'Test');
INSERT INTO tenant_competitor_origin (origin, enabled) VALUES ('DROGAL', true);
-- Cross-schema join
SELECT bp.ean, bp.description, tco.origin
  FROM base_product bp
  CROSS JOIN tenant_competitor_origin tco;
SQL
```

Expected: one row with `(7891234567890, 'Test', 'DROGAL')`.

- [x] **Step 4: Commit (no code changes; just verification step)**

No commit needed.

---

## Exit Criteria

- [x] `npm run migration:run:app` creates `core` + `shared_catalog`, inserts the `system` tenant.
- [x] `npm run tenant:create <slug>` creates a `tenant_<slug>` schema, inserts the tenant row, runs tenant template migrations.
- [x] `npm run migration:tenant:all` iterates active tenants and migrates each (concurrency 10).
- [x] Cross-schema query (`SELECT bp.ean FROM shared_catalog.base_product bp` inside a `search_path = tenant_x, shared_catalog, public` session) works.
- [x] `import_process` does not exist anywhere.
- [x] Simplified `base_product` has only: `id, ean, description, active_ingredient, generic, height, length, width, weight, created_at, updated_at, deleted_at`.
- [x] All entities live under `src/database/entities/{core,shared-catalog,tenant}/`.
- [x] All entity files compile (`npm run build`).
