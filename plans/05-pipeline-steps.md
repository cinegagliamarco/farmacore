# 05 — Pipeline Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed (v1 stubs).** Plan 05 was executed: 8 step consumers + `pipeline.start` fan-out + 2-branch join all in place and green end-to-end (8 step rows + 2 `branch.*` rows per run, `completed`, join fires once). Bundled fixes: `core.pipeline_run.tenant_id` changed to `text`; `Plan 09 AmqpInterceptor` guarded against `@golevelup` shape (passes through when `getChannelRef` is absent).
>
> **⚠ Plan 05 v2 — in progress.** Phase A (dispatcher/batch foundation: pipeline_run schema extensions, BatchPipelineConsumer + DispatchPipelineConsumer base classes, per-origin queue constants) landed in commits `fc8e47f`..`512a8c9`. Phase B step ports underway:
> - **B1 (sync-base-product) — ✅ ported.** `tenant_base_product` renamed and extended to `tenant_product` with ERP columns; A7Pharma read repos under `src/integration/repositories/a7pharma/`; tenant/shared-catalog write repos under `src/database/repositories/`; `SyncBaseProductStep` ports the legacy business logic; v1 consumer replaced by `SyncBaseProductDispatchConsumer` + `SyncBaseProductBatchConsumer`; `pipeline.start` now publishes to the `.dispatch` queue. Helper specs cover EAN parsing, generic-classification matching, deals building. End-to-end validation against real ERP is the responsibility of the operator (see `docs/pipeline/sync-base-product-e2e.md`).
> - **B2 (sync-base-product-stock) — ✅ ported.** New tables `tenant_subsidiary` (label lookup) + `tenant_product_stock` (ean, subsidiary_external_id, quantity). Replaces legacy hardcoded `SubsidiaryMaping` enum with per-tenant configuration. `EstoqueRepository` added to A7Pharma bundle; `TenantProductStockRepository` writes; `SyncBaseProductStockStep` aggregates per (ean, subsidiary). BatchPipelineConsumer split into `handle()` + `successors()` so the join check runs only on the last batch. v1 consumer replaced by dispatch+batch pair preserving `PipelineJoinService.markBranchComplete('stock-a')`. Step spec covers EAN dropout + cross-embalagem aggregation.
> - **Post-B2 review fixes** — `/codex review` against B1+B2 surfaced 4 issues. Fixed: classification race (partial UNIQUE + ON CONFLICT), empty stock dispatch leaving join branch unmarked, cross-batch undercount (dispatchers now chunk by EAN so all embalagens sharing a barcode land in one batch). **Deferred to Phase D**: fan-in atomicity window between `complete` and `incrementBatchDone` — see [`notes/fan-in-atomicity.md`](./notes/fan-in-atomicity.md).
> - **B3 (sync-offer-books-info) — ✅ ported.** Legacy mixed two concepts as "OfferBookInfo": extension metadata on a per-EAN offer_book row (already in the new schema as `offer_book_info`) and a tenant-wide ERP campaign catalog. New table `tenant_offer_campaign` (external_id unique, name, active, start_date, expiration_date) handles the second role. `CadernoOfertaRepository.findAll` + `TenantOfferCampaignRepository.upsertManyByExternalId`. Single-shot step (no dispatch/batch; ~100 rows/tenant). v1 consumer signature updated for the new step shape.
> - **B4–B6** — pending.
>
> Original v2-pending note for reference:
> The step `handle()` methods are still stubs that log and return. Porting the real legacy work needs a different message shape than what v1 ships: the hot steps (`sync-base-product`, `sync-base-product-stock`, `import-competitor-products`, `import-competitor-stock`, `calc-base-product-metrics`, `update-base-product-properties`) fan out over ~36k base_products × 2–3 competitor origins. Legacy keeps that all in one Node process with `global.gc()` calls every 30-50 items — we won't.
>
> The v2 design is in [`notes/pipeline-throughput.md`](./notes/pipeline-throughput.md). Summary:
> - Each heavy step becomes **two queues**: `<step>.dispatch` (one message per run, scans the source, emits N batch messages) and `<step>.batch` (one message per ~500 IDs, does the work and ack's).
> - The two-branch join in v1 is replaced by a **fan-in counter** on `pipeline_run` (`batches_planned` vs `batches_done` on the dispatch row; the batch that closes the gap publishes the successor).
> - Scrape steps split **per origin** — `import-competitor-products.drogal`, `…drogasil`, `…michelassi` — so a slow vendor can't head-of-line block the others. Per-origin prefetch is the rate-limit knob: Drogal/Drogasil = 8, Michelassi = 2 (legacy ran Michelassi at batch=1, delay=350ms).
> - Dispatcher idempotency: the unique index on `pipeline_run` extends to `(runId, step, batch_seq)`. A redelivered dispatcher sees an existing row and exits without double-publishing.
>
> See the notes file for the full topology table, message-volume estimates (~108k msgs/run/tenant — dominated by scrape queues), and the rationale on batch size + prefetch.

**Goal:** Implement the 8 step consumers from `arc/02 §3` plus the `pipeline.start` fan-out consumer, the parallel-branch join, the daily cron publisher, and the post-deploy `migrate-tenant` job.

**Architecture:** Each step is a class extending `BasePipelineConsumer` (plan 04). It implements `handle(ctx)` and returns successor messages. The dependency graph from `arc/02 §3`:

```
pipeline.start
  ├── sync-base-product ─► sync-base-product-stock ──┐
  └── sync-offer-books-info                          │
                                                     ▼ (waits for both chain A + B)
       import-competitor-products ─► import-competitor-stock
                                          │
                                          ▼
                                    calc-base-product-metrics
                                          │
                                          ▼
                                    update-base-product-properties
                                          │
                                          ▼
                                    update-active-ingredient-mat
```

**Wait**: re-reading `arc/02 §3`: the join is between **`sync-base-product-stock`** (chain A) and **`import-competitor-stock`** (chain B) → both must complete before `calc-base-product-metrics`. The graph is:

```
pipeline.start
  ├── sync-base-product ──► sync-base-product-stock ──────┐
  │                                                       ├─►  calc-metrics ─► update-props ─► update-ai-mat
  └── sync-offer-books-info → import-comp-products → import-comp-stock ──┘
```

We implement that exactly: `sync-base-product-stock` and `import-competitor-stock` each post a "branch-complete" marker on `pipeline_run`. The first to finish does nothing; the second triggers `calc-base-product-metrics` (the "join" logic in the base — see Task 1).

**Tech Stack:** Per-step consumers, TypeORM-based reads/writes against the per-tenant schema and shared catalog, Cheerio for HTML scraping (deferred — actual scrape impl lives in step modules with their own deps).

**Reference:** `arc/02-queue-and-routines.md` §3, §4, §5, §6, §7, §8, §11.

---

## Interfaces Exposed

- **Module:** `PipelineStepsModule` (registers all 8 step consumers + `PipelineStartConsumer` + `MigrateTenantConsumer`).
- **Step consumer classes:**
  - `PipelineStartConsumer` — fans out into `sync-base-product` and `sync-offer-books-info`.
  - `SyncBaseProductConsumer` — ERP → `shared_catalog.base_product`. Chains to `sync-base-product-stock`.
  - `SyncBaseProductStockConsumer` — chain A stock. Calls join helper.
  - `SyncOfferBooksInfoConsumer` — chains to `import-competitor-products`.
  - `ImportCompetitorProductsConsumer` — chains to `import-competitor-stock`.
  - `ImportCompetitorStockConsumer` — chain B stock. Calls join helper.
  - `CalcBaseProductMetricsConsumer` — chains to `update-base-product-properties`.
  - `UpdateBaseProductPropertiesConsumer` — chains to `update-active-ingredient-mat`.
  - `UpdateActiveIngredientMatConsumer` — terminal step.
- **Join helper:** `PipelineJoinService.markBranchComplete(pipelineRunId, branch)` returning `'wait' | 'fire'`.
- **Cron:** `DailyPipelineCron` — daily at 00:00 UTC publishes `pipeline.start` for every active tenant.
- **Admin trigger:** `AdminPipelineService.start(tenantSlug, userId): Promise<{ pipelineRunId }>` — used by plan 06.
- **Migrator:** `MigrateTenantConsumer` — runs tenant template migrations for one tenant. `PostDeployMigratorJob` (CLI entry point) enqueues per-tenant migrate jobs.
- **CLI scripts:** `scripts/enqueue-migrate-all.ts` — Fly release_command entry.

---

## File Structure

```
src/pipeline/
├─ pipeline-steps.module.ts
├─ pipeline-join.service.ts
├─ pipeline-join.service.spec.ts
├─ admin-pipeline.service.ts
├─ daily-pipeline.cron.ts
├─ consumers/
│  ├─ pipeline-start.consumer.ts
│  ├─ sync-base-product.consumer.ts
│  ├─ sync-base-product-stock.consumer.ts
│  ├─ sync-offer-books-info.consumer.ts
│  ├─ import-competitor-products.consumer.ts
│  ├─ import-competitor-stock.consumer.ts
│  ├─ calc-base-product-metrics.consumer.ts
│  ├─ update-base-product-properties.consumer.ts
│  ├─ update-active-ingredient-mat.consumer.ts
│  └─ migrate-tenant.consumer.ts
└─ steps/                                       # business logic — testable separately from consumers
   ├─ sync-base-product.step.ts
   ├─ sync-base-product-stock.step.ts
   ├─ sync-offer-books-info.step.ts
   ├─ import-competitor-products.step.ts
   ├─ import-competitor-stock.step.ts
   ├─ calc-base-product-metrics.step.ts
   ├─ update-base-product-properties.step.ts
   └─ update-active-ingredient-mat.step.ts

scripts/
└─ enqueue-migrate-all.ts
```

> **Why split consumer / step:** the consumer wires DI and RMQ; the step is the pure use-case. Tests target the step class directly with no RMQ involved.

---

### Task 1: PipelineJoinService

**Files:** `src/pipeline/pipeline-join.service.ts`, `.spec.ts`

The join uses a row in `core.pipeline_run` with `step = 'branch.<name>'` as the marker. When both branches' markers exist with `status=completed`, the second one to land calls `fire`.

**Schema note:** the existing `CHECK (status IN ('running','completed','failed'))` and `(pipelineRunId, step) UNIQUE` constraints from plan 01 already accommodate arbitrary step strings. We use synthetic step names `'branch.stock-a'` and `'branch.stock-b'`. To allow these, the migration's `pipeline_step` enum doesn't constrain the `step` column at the DB level (we kept it as `text` in plan 01 §15) — confirm by re-reading the migration.

- [x] **Step 1: Confirm step column is text without enum check**

Open `migrations/core/1700000000000-init-core.ts` and verify the `pipeline_run.step` column is `text` with no `CHECK` constraint. If a check was added, drop it in a new migration.

If you find a CHECK constraint that restricts step values, create `migrations/core/1700000000003-allow-synthetic-pipeline-steps.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowSyntheticPipelineSteps1700000000003 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE core.pipeline_run DROP CONSTRAINT IF EXISTS chk_pipeline_run_step`);
  }
  public async down(qr: QueryRunner): Promise<void> {}
}
```

- [x] **Step 2: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PipelineJoinService } from './pipeline-join.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';

describe('PipelineJoinService.markBranchComplete', () => {
  let svc: PipelineJoinService;
  let repo: { findOne: jest.Mock; save: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    repo = { findOne: jest.fn(), save: jest.fn(), count: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [PipelineJoinService, { provide: getRepositoryToken(PipelineRunEntity), useValue: repo }],
    }).compile();
    svc = mod.get(PipelineJoinService);
  });

  it('returns "wait" when the other branch has not landed', async () => {
    repo.count.mockResolvedValue(1);   // only our row exists after save
    const r = await svc.markBranchComplete('run1', 'tid', 'stock-a');
    expect(r).toBe('wait');
  });

  it('returns "fire" when both branches are complete', async () => {
    repo.count.mockResolvedValue(2);
    const r = await svc.markBranchComplete('run1', 'tid', 'stock-b');
    expect(r).toBe('fire');
  });
});
```

- [x] **Step 3: Run, expect fail**

Run: `npm test -- src/pipeline/pipeline-join.service.spec.ts`
Expected: FAIL.

- [x] **Step 4: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';

export type JoinBranch = 'stock-a' | 'stock-b';

@Injectable()
export class PipelineJoinService {
  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly repo: Repository<PipelineRunEntity>,
  ) {}

  public async markBranchComplete(
    pipelineRunId: string,
    tenantId: string,
    branch: JoinBranch,
  ): Promise<'wait' | 'fire'> {
    const stepKey = `branch.${branch}`;
    await this.repo.save({
      pipelineRunId,
      tenantId,
      step: stepKey,
      status: PipelineRunStatus.COMPLETED,
      attempt: 1,
      startedAt: new Date(),
      finishedAt: new Date(),
    });
    const count = await this.repo.count({
      where: [
        { pipelineRunId, step: 'branch.stock-a', status: PipelineRunStatus.COMPLETED },
        { pipelineRunId, step: 'branch.stock-b', status: PipelineRunStatus.COMPLETED },
      ],
    });
    return count >= 2 ? 'fire' : 'wait';
  }
}
```

- [x] **Step 5: Run, expect pass**

Run: `npm test -- src/pipeline/pipeline-join.service.spec.ts`
Expected: PASS (2 tests).

- [x] **Step 6: Commit**

```bash
git add src/pipeline/pipeline-join.service.ts src/pipeline/pipeline-join.service.spec.ts migrations/
git commit -m "feat(pipeline): PipelineJoinService for parallel-branch join"
```

---

### Task 2: Step implementations (stubs first)

For v1, the step business logic is **stubbed** to write the smallest possible "I ran" side effect. Replacing the stubs with the real ERP/scrape logic is out of scope for this plan — it's tracked under "Open Questions" in `arc/02 §12` and depends on details (which sites, schedule, etc.) not yet locked.

Each step file has the same shape:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class XxxStep {
  private readonly logger = new Logger(XxxStep.name);

  public async run(em: EntityManager, integrationDs: DataSource | null, tenantId: string): Promise<void> {
    this.logger.log(`[stub] running XxxStep for ${tenantId}`);
    // TODO(arc-02): port real logic from farmacore/.
  }
}
```

- [x] **Step 1: Create all 8 step stubs**

`src/pipeline/steps/sync-base-product.step.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class SyncBaseProductStep {
  private readonly logger = new Logger(SyncBaseProductStep.name);
  public async run(em: EntityManager, _integration: DataSource | null, tenantId: string): Promise<void> {
    this.logger.log(`[stub] sync-base-product for ${tenantId}`);
  }
}
```

Repeat the same pattern for:
- `SyncBaseProductStockStep`
- `SyncOfferBooksInfoStep`
- `ImportCompetitorProductsStep`
- `ImportCompetitorStockStep`
- `CalcBaseProductMetricsStep`
- `UpdateBaseProductPropertiesStep`
- `UpdateActiveIngredientMatStep`

Each is identical except for the class name + log message.

- [x] **Step 2: Commit**

```bash
git add src/pipeline/steps/
git commit -m "feat(pipeline): stub step implementations"
```

---

### Task 3: PipelineStartConsumer

**Files:** `src/pipeline/consumers/pipeline-start.consumer.ts`

This is **not** a `BasePipelineConsumer` (no idempotency/retry concerns — it just fans out). It's a plain `@RabbitSubscribe` handler.

- [x] **Step 1: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, PIPELINE_START_QUEUE } from '../../queue/constants';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineMessage, newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';

@Injectable()
export class PipelineStartConsumer {
  private readonly logger = new Logger(PipelineStartConsumer.name);

  constructor(private readonly publisher: PipelinePublisher) {}

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: '*.pipeline.start',
    queue: PIPELINE_START_QUEUE,
  })
  public async handle(message: PipelineMessage): Promise<void> {
    this.logger.log(`pipeline.start for tenant=${message.tenantId} run=${message.pipelineRunId}`);
    await this.publisher.publishStep(newPipelineMessage({
      pipelineRunId: message.pipelineRunId,
      tenantId: message.tenantId,
      step: PipelineStep.SYNC_BASE_PRODUCT,
      payload: {},
    }));
    await this.publisher.publishStep(newPipelineMessage({
      pipelineRunId: message.pipelineRunId,
      tenantId: message.tenantId,
      step: PipelineStep.SYNC_OFFER_BOOKS_INFO,
      payload: {},
    }));
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/pipeline/consumers/pipeline-start.consumer.ts
git commit -m "feat(pipeline): pipeline.start fan-out consumer"
```

---

### Task 4: Step consumers — chain A

**Files:** `sync-base-product.consumer.ts`, `sync-base-product-stock.consumer.ts`

Each step consumer:
1. Extends `BasePipelineConsumer`.
2. Calls its `XxxStep.run(em, integrationDs, tenantId)`.
3. Returns successors.

- [x] **Step 1: SyncBaseProductConsumer**

```ts
import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { BasePipelineConsumer, HandleContext, HandleResult } from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncBaseProductStep } from '../steps/sync-base-product.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

@Injectable()
export class SyncBaseProductConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.SYNC_BASE_PRODUCT;

  constructor(
    private readonly stepImpl: SyncBaseProductStep,
    runs: PipelineRunService,
    retry: RetryService,
    tx: TenantTransactionService,
    tenants: TenantService,
    integration: IntegrationDataSourceFactory,
    publisher: PipelinePublisher,
  ) { super(runs, retry, tx, tenants, integration, publisher); }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.SYNC_BASE_PRODUCT}`,
    queue: PipelineStep.SYNC_BASE_PRODUCT,
    queueOptions: { channel: 'sync-base-product', prefetchCount: STEP_PREFETCH[PipelineStep.SYNC_BASE_PRODUCT] },
  })
  public consume(message: Parameters<this['process']>[0]): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);
    return {
      successors: [newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
        payload: {},
      })],
    };
  }
}
```

- [x] **Step 2: SyncBaseProductStockConsumer (calls join, branch=stock-a)**

```ts
import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { BasePipelineConsumer, HandleContext, HandleResult } from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncBaseProductStockStep } from '../steps/sync-base-product-stock.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';

@Injectable()
export class SyncBaseProductStockConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.SYNC_BASE_PRODUCT_STOCK;

  constructor(
    private readonly stepImpl: SyncBaseProductStockStep,
    private readonly join: PipelineJoinService,
    runs: PipelineRunService, retry: RetryService, tx: TenantTransactionService,
    tenants: TenantService, integration: IntegrationDataSourceFactory, publisher: PipelinePublisher,
  ) { super(runs, retry, tx, tenants, integration, publisher); }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.SYNC_BASE_PRODUCT_STOCK}`,
    queue: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
    queueOptions: { channel: 'sync-base-product-stock', prefetchCount: STEP_PREFETCH[PipelineStep.SYNC_BASE_PRODUCT_STOCK] },
  })
  public consume(message: Parameters<this['process']>[0]): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);

    const branchOutcome = await this.join.markBranchComplete(
      ctx.message.pipelineRunId, ctx.message.tenantId, 'stock-a',
    );
    if (branchOutcome === 'wait') return { successors: [] };

    return {
      successors: [newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.CALC_BASE_PRODUCT_METRICS,
        payload: {},
      })],
    };
  }
}
```

- [x] **Step 3: Commit**

```bash
git add src/pipeline/consumers/sync-base-product.consumer.ts \
        src/pipeline/consumers/sync-base-product-stock.consumer.ts
git commit -m "feat(pipeline): chain A consumers (sync-base-product + stock with join)"
```

---

### Task 5: Step consumers — chain B

**Files:** `sync-offer-books-info.consumer.ts`, `import-competitor-products.consumer.ts`, `import-competitor-stock.consumer.ts`

Follow the same template as Task 4. The third one calls `markBranchComplete(..., 'stock-b')` and publishes `calc-base-product-metrics` only on `fire`.

- [x] **Step 1: SyncOfferBooksInfoConsumer**

Successor: `IMPORT_COMPETITOR_PRODUCTS`.

```ts
import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { BasePipelineConsumer, HandleContext, HandleResult } from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { SyncOfferBooksInfoStep } from '../steps/sync-offer-books-info.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';

@Injectable()
export class SyncOfferBooksInfoConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.SYNC_OFFER_BOOKS_INFO;

  constructor(
    private readonly stepImpl: SyncOfferBooksInfoStep,
    runs: PipelineRunService, retry: RetryService, tx: TenantTransactionService,
    tenants: TenantService, integration: IntegrationDataSourceFactory, publisher: PipelinePublisher,
  ) { super(runs, retry, tx, tenants, integration, publisher); }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.SYNC_OFFER_BOOKS_INFO}`,
    queue: PipelineStep.SYNC_OFFER_BOOKS_INFO,
    queueOptions: { channel: 'sync-offer-books-info', prefetchCount: STEP_PREFETCH[PipelineStep.SYNC_OFFER_BOOKS_INFO] },
  })
  public consume(message: Parameters<this['process']>[0]): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);
    return {
      successors: [newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
        payload: {},
      })],
    };
  }
}
```

- [x] **Step 2: ImportCompetitorProductsConsumer**

Same template; successor `IMPORT_COMPETITOR_STOCK`; use `ImportCompetitorProductsStep`.

- [x] **Step 3: ImportCompetitorStockConsumer (calls join, branch=stock-b)**

```ts
import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { BasePipelineConsumer, HandleContext, HandleResult } from '../../queue/base-pipeline.consumer';
import { EXCHANGE_NAME, STEP_PREFETCH } from '../../queue/constants';
import { newPipelineMessage } from '../../queue/types';
import { PipelineStep } from '../../database/enums/pipeline-step.enum';
import { ImportCompetitorStockStep } from '../steps/import-competitor-stock.step';
import { PipelineRunService } from '../../queue/pipeline-run.service';
import { RetryService } from '../../queue/retry.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { TenantService } from '../../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../../integration/integration-data-source.factory';
import { PipelinePublisher } from '../../queue/pipeline-publisher.service';
import { PipelineJoinService } from '../pipeline-join.service';

@Injectable()
export class ImportCompetitorStockConsumer extends BasePipelineConsumer {
  protected readonly step = PipelineStep.IMPORT_COMPETITOR_STOCK;

  constructor(
    private readonly stepImpl: ImportCompetitorStockStep,
    private readonly join: PipelineJoinService,
    runs: PipelineRunService, retry: RetryService, tx: TenantTransactionService,
    tenants: TenantService, integration: IntegrationDataSourceFactory, publisher: PipelinePublisher,
  ) { super(runs, retry, tx, tenants, integration, publisher); }

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: `*.${PipelineStep.IMPORT_COMPETITOR_STOCK}`,
    queue: PipelineStep.IMPORT_COMPETITOR_STOCK,
    queueOptions: { channel: 'import-competitor-stock', prefetchCount: STEP_PREFETCH[PipelineStep.IMPORT_COMPETITOR_STOCK] },
  })
  public consume(message: Parameters<this['process']>[0]): Promise<void> {
    return this.process(message);
  }

  protected async handle(ctx: HandleContext): Promise<HandleResult> {
    await this.stepImpl.run(ctx.em, ctx.integrationDs, ctx.message.tenantId);
    const branchOutcome = await this.join.markBranchComplete(
      ctx.message.pipelineRunId, ctx.message.tenantId, 'stock-b',
    );
    if (branchOutcome === 'wait') return { successors: [] };
    return {
      successors: [newPipelineMessage({
        pipelineRunId: ctx.message.pipelineRunId,
        tenantId: ctx.message.tenantId,
        step: PipelineStep.CALC_BASE_PRODUCT_METRICS,
        payload: {},
      })],
    };
  }
}
```

- [x] **Step 4: Commit**

```bash
git add src/pipeline/consumers/sync-offer-books-info.consumer.ts \
        src/pipeline/consumers/import-competitor-products.consumer.ts \
        src/pipeline/consumers/import-competitor-stock.consumer.ts
git commit -m "feat(pipeline): chain B consumers"
```

---

### Task 6: Terminal chain consumers

**Files:** `calc-base-product-metrics.consumer.ts`, `update-base-product-properties.consumer.ts`, `update-active-ingredient-mat.consumer.ts`

These three are sequential with no joins. Use the same template as `SyncOfferBooksInfoConsumer`.

- [x] **Step 1: Three consumers**

- `CalcBaseProductMetricsConsumer` → successor `UPDATE_BASE_PRODUCT_PROPERTIES`.
- `UpdateBaseProductPropertiesConsumer` → successor `UPDATE_ACTIVE_INGREDIENT_MAT`.
- `UpdateActiveIngredientMatConsumer` → terminal (returns `{ successors: [] }`).

Adapt the `SyncOfferBooksInfoConsumer` template for each — change step name, step impl class, and successor list.

- [x] **Step 2: Commit**

```bash
git add src/pipeline/consumers/calc-base-product-metrics.consumer.ts \
        src/pipeline/consumers/update-base-product-properties.consumer.ts \
        src/pipeline/consumers/update-active-ingredient-mat.consumer.ts
git commit -m "feat(pipeline): terminal chain consumers (calc-metrics → props → mat)"
```

---

### Task 7: MigrateTenantConsumer

**Files:** `src/pipeline/consumers/migrate-tenant.consumer.ts`

Per `arc/02 §8`: after deploy, iterate active tenants and apply tenant template migrations. Concurrency cap is 10 (handled by the RMQ prefetch on this queue + `concurrency: 10` consumer option).

- [x] **Step 1: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { execSync } from 'node:child_process';
import { EXCHANGE_NAME, MIGRATE_TENANT_QUEUE } from '../../queue/constants';

interface MigrateTenantMessage {
  tenantSlug: string;
  publishedAt: string;
}

@Injectable()
export class MigrateTenantConsumer {
  private readonly logger = new Logger(MigrateTenantConsumer.name);

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: '*.migrate-tenant',
    queue: MIGRATE_TENANT_QUEUE,
    queueOptions: { channel: 'migrate-tenant', prefetchCount: 10 },
  })
  public handle(message: MigrateTenantMessage): void {
    this.logger.log(`Migrating tenant ${message.tenantSlug}`);
    execSync(`npm run migration:tenant ${message.tenantSlug}`, { stdio: 'inherit' });
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/pipeline/consumers/migrate-tenant.consumer.ts
git commit -m "feat(pipeline): MigrateTenantConsumer (post-deploy migrator)"
```

---

### Task 8: enqueue-migrate-all script (Fly release_command hook)

**Files:** `scripts/enqueue-migrate-all.ts`

This script runs the app + shared migrations directly (in-process), then enqueues `migrate-tenant` messages for every active tenant. It's the release_command on both Fly apps.

- [x] **Step 1: Implement**

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { execSync } from 'node:child_process';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { EXCHANGE_NAME } from '../src/queue/constants';

async function main(): Promise<void> {
  // 1) App-level migrations (core + shared_catalog).
  execSync('npm run migration:run:app', { stdio: 'inherit' });

  // 2) Bootstrap app to enqueue tenant migrations.
  const app = await NestFactory.createApplicationContext(AppModule);
  const ds = app.get(DataSource);
  const amqp = app.get(AmqpConnection);

  const tenants: Array<{ slug: string }> = await ds.query(
    `SELECT slug FROM core.tenant WHERE status = 'active' AND slug <> 'system' ORDER BY slug`,
  );

  for (const t of tenants) {
    await amqp.publish(
      EXCHANGE_NAME,
      `${t.slug}.migrate-tenant`,
      { tenantSlug: t.slug, publishedAt: new Date().toISOString() },
      { persistent: true },
    );
  }

  console.log(`Enqueued ${tenants.length} tenant migration(s).`);
  await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [x] **Step 2: Wire as release_command in fly.toml (plan 08 picks this up)**

Document the path for plan 08: `[deploy] release_command = "node dist/scripts/enqueue-migrate-all.js"`. No code change here.

- [x] **Step 3: Commit**

```bash
git add scripts/enqueue-migrate-all.ts
git commit -m "feat(pipeline): release_command script — migrate app + enqueue tenants"
```

---

### Task 9: DailyPipelineCron

**Files:** `src/pipeline/daily-pipeline.cron.ts`

Cron lives in the **API** service only (per `arc/02 §6`) — guard with an env check so the worker doesn't double-publish.

- [x] **Step 1: Install scheduler**

```bash
npm install @nestjs/schedule
```

- [x] **Step 2: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';

@Injectable()
export class DailyPipelineCron {
  private readonly logger = new Logger(DailyPipelineCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly publisher: PipelinePublisher,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;   // safety: cron only on API
    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      if (t.slug === 'system') continue;
      const runId = await this.publisher.publishStart(t.slug, { reason: 'cron' });
      this.logger.log(`Published pipeline.start for ${t.slug} run=${runId}`);
    }
  }
}
```

- [x] **Step 3: Commit**

```bash
git add src/pipeline/daily-pipeline.cron.ts package.json
git commit -m "feat(pipeline): DailyPipelineCron (API-only)"
```

---

### Task 10: AdminPipelineService

**Files:** `src/pipeline/admin-pipeline.service.ts`

Used by plan 06 to expose `POST /admin/tenants/:slug/pipeline:start`.

- [x] **Step 1: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { TenantService } from '../tenant/tenant.service';
import { PipelinePublisher } from '../queue/pipeline-publisher.service';

@Injectable()
export class AdminPipelineService {
  constructor(
    private readonly tenants: TenantService,
    private readonly publisher: PipelinePublisher,
  ) {}

  public async startForTenant(tenantSlug: string, userId: string): Promise<{ pipelineRunId: string }> {
    await this.tenants.findActive(tenantSlug);
    const pipelineRunId = await this.publisher.publishStart(tenantSlug, { reason: 'manual', startedBy: userId });
    return { pipelineRunId };
  }
}
```

- [x] **Step 2: Commit**

```bash
git add src/pipeline/admin-pipeline.service.ts
git commit -m "feat(pipeline): AdminPipelineService.startForTenant"
```

---

### Task 11: PipelineStepsModule

**Files:** `src/pipeline/pipeline-steps.module.ts`

- [x] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';

import { PipelineJoinService } from './pipeline-join.service';
import { AdminPipelineService } from './admin-pipeline.service';
import { DailyPipelineCron } from './daily-pipeline.cron';

import { SyncBaseProductStep } from './steps/sync-base-product.step';
import { SyncBaseProductStockStep } from './steps/sync-base-product-stock.step';
import { SyncOfferBooksInfoStep } from './steps/sync-offer-books-info.step';
import { ImportCompetitorProductsStep } from './steps/import-competitor-products.step';
import { ImportCompetitorStockStep } from './steps/import-competitor-stock.step';
import { CalcBaseProductMetricsStep } from './steps/calc-base-product-metrics.step';
import { UpdateBaseProductPropertiesStep } from './steps/update-base-product-properties.step';
import { UpdateActiveIngredientMatStep } from './steps/update-active-ingredient-mat.step';

import { PipelineStartConsumer } from './consumers/pipeline-start.consumer';
import { SyncBaseProductConsumer } from './consumers/sync-base-product.consumer';
import { SyncBaseProductStockConsumer } from './consumers/sync-base-product-stock.consumer';
import { SyncOfferBooksInfoConsumer } from './consumers/sync-offer-books-info.consumer';
import { ImportCompetitorProductsConsumer } from './consumers/import-competitor-products.consumer';
import { ImportCompetitorStockConsumer } from './consumers/import-competitor-stock.consumer';
import { CalcBaseProductMetricsConsumer } from './consumers/calc-base-product-metrics.consumer';
import { UpdateBaseProductPropertiesConsumer } from './consumers/update-base-product-properties.consumer';
import { UpdateActiveIngredientMatConsumer } from './consumers/update-active-ingredient-mat.consumer';
import { MigrateTenantConsumer } from './consumers/migrate-tenant.consumer';

const STEPS = [
  SyncBaseProductStep, SyncBaseProductStockStep, SyncOfferBooksInfoStep,
  ImportCompetitorProductsStep, ImportCompetitorStockStep,
  CalcBaseProductMetricsStep, UpdateBaseProductPropertiesStep, UpdateActiveIngredientMatStep,
];

const CONSUMERS = [
  PipelineStartConsumer,
  SyncBaseProductConsumer, SyncBaseProductStockConsumer,
  SyncOfferBooksInfoConsumer, ImportCompetitorProductsConsumer, ImportCompetitorStockConsumer,
  CalcBaseProductMetricsConsumer, UpdateBaseProductPropertiesConsumer, UpdateActiveIngredientMatConsumer,
  MigrateTenantConsumer,
];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([PipelineRunEntity]),
  ],
  providers: [
    PipelineJoinService,
    AdminPipelineService,
    DailyPipelineCron,
    ...STEPS,
    ...CONSUMERS,
  ],
  exports: [AdminPipelineService, PipelineJoinService],
})
export class PipelineStepsModule {}
```

- [x] **Step 2: Wire into WorkerModule and AppModule**

- `WorkerModule` imports `PipelineStepsModule` so it runs the consumers + cron's underlying providers.
- `AppModule` imports it too so `AdminPipelineService` is available to plan 06's controllers, and the cron runs there (but is guarded by `WORKER_MODE !== '1'`).

> **Note:** `@RabbitSubscribe` decorators only register consumers when the module that contains them is loaded *and* there is an active RMQ connection. The API will declare topology + register consumers, but real consumer work mostly happens on the worker. To avoid duplicate consumption from API + worker, we keep all consumer registration in `PipelineStepsModule` but rely on Fly to split: only the worker app has high concurrency, the API has 1 instance and prefetch is bounded. Acceptable for v1 — see Task 13.

- [x] **Step 3: Commit**

```bash
git add src/pipeline/pipeline-steps.module.ts src/app.module.ts src/worker.module.ts
git commit -m "feat(pipeline): PipelineStepsModule wires all consumers + cron + steps"
```

---

### Task 12: Restrict consumer registration to worker only

To prevent the API from also pulling jobs (which would race the worker and break tenant ordering), gate consumer registration behind `WORKER_MODE`.

The cleanest way: in `pipeline-steps.module.ts` build two providers arrays and use a conditional `providers:`.

- [x] **Step 1: Replace module providers with a factory**

```ts
import { DynamicModule, Module } from '@nestjs/common';
// ... existing imports ...

@Module({})
export class PipelineStepsModule {
  public static forRoot(options: { withConsumers: boolean }): DynamicModule {
    return {
      module: PipelineStepsModule,
      imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([PipelineRunEntity]),
      ],
      providers: [
        PipelineJoinService,
        AdminPipelineService,
        DailyPipelineCron,
        ...STEPS,
        ...(options.withConsumers ? CONSUMERS : []),
      ],
      exports: [AdminPipelineService, PipelineJoinService],
    };
  }
}
```

- [x] **Step 2: Use it in worker vs api**

- `WorkerModule`: `PipelineStepsModule.forRoot({ withConsumers: true })`
- `AppModule`: `PipelineStepsModule.forRoot({ withConsumers: false })`

- [x] **Step 3: Commit**

```bash
git add src/pipeline/pipeline-steps.module.ts src/app.module.ts src/worker.module.ts
git commit -m "refactor(pipeline): consumers register on worker only via forRoot()"
```

---

### Task 13: End-to-end pipeline smoke test

- [x] **Step 1: Boot the local stack**

```bash
docker compose up -d postgres rabbitmq erp
npm run migration:run:app
npm run tenant:create acme || true
npm run seed:system-admin
```

- [x] **Step 2: Run worker + API in parallel terminals**

Terminal 1: `npm run start:dev`
Terminal 2: `npm run build && WORKER_MODE=1 node dist/main.js`

- [x] **Step 3: Trigger a run via the publisher**

Quick REPL trigger:
```bash
cat <<'EOF' > /tmp/trigger.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PipelinePublisher } from './src/queue/pipeline-publisher.service';

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule);
  const runId = await app.get(PipelinePublisher).publishStart('acme', { reason: 'manual' });
  console.log('runId =', runId);
  await app.close();
})();
EOF
ts-node /tmp/trigger.ts
```

- [x] **Step 4: Verify completion in psql**

```bash
psql postgres://app:app@localhost:5432/app -c "
  SELECT step, status, attempt FROM core.pipeline_run
  WHERE pipeline_run_id = '<paste runId>' ORDER BY started_at;
"
```

Expected: 8 step rows + 2 `branch.*` rows, all `status = completed`. Steps appear in the order:

```
sync-base-product
sync-base-product-stock
branch.stock-a
sync-offer-books-info
import-competitor-products
import-competitor-stock
branch.stock-b
calc-base-product-metrics
update-base-product-properties
update-active-ingredient-mat
```

- [x] **Step 5: Commit (no code changes — verification)**

---

## Exit Criteria

- [x] All 8 step queues + their consumers are registered on the worker only.
- [x] `pipeline.start` fans out into `sync-base-product` and `sync-offer-books-info`.
- [x] `sync-base-product-stock` and `import-competitor-stock` join via `PipelineJoinService` — `calc-base-product-metrics` runs exactly once when both complete.
- [x] `MigrateTenantConsumer` runs `npm run migration:tenant <slug>` on each `*.migrate-tenant` message; the release_command enqueues one per active tenant.
- [x] `DailyPipelineCron` (UTC midnight) publishes a `pipeline.start` for every active tenant on the **API** node only.
- [x] `AdminPipelineService.startForTenant(slug, userId)` returns a `pipelineRunId` and a full pipeline run completes end-to-end against the docker-compose stack.
- [x] No `import_process` row anywhere; `pipeline_run` is the single audit source of truth.
- [x] A retry attempt eventually lands in `<step>.dlq` after `MAX_ATTEMPTS` failures (verified manually by making `SyncBaseProductStep.run` throw and watching CloudAMQP's management UI).
