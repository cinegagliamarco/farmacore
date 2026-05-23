# 04 — Queue Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

> **Status: ✅ Executed.** Plan 04 was executed. Three deviations: (1) `prefetchCount` moved from `queueOptions` to module-level `channels:` config (the @golevelup type does not accept it under queueOptions); (2) all consumers add `import type { PipelineMessage }` for `isolatedModules` + `emitDecoratorMetadata`; (3) consumers set `createQueueIfNotExists: false` so they bind to the queues QueueModule already declared.

**Goal:** Stand up the RabbitMQ layer — topic exchange, per-step queues, DLQs, a `PipelinePublisher` used by the API to enqueue work, a delayed-retry helper, and a generic `BasePipelineConsumer` that every step in plan 05 extends.

**Architecture:** One topic exchange `pipeline.<env>`; each step has a durable queue `<step>` (bound `*.<step>`) and a dead-letter queue `<step>.dlq`. Retries are driven by per-message TTL via a delay exchange (`pipeline.<env>.delay` — headers exchange with `x-delayed-message` plugin OR a per-attempt dead-letter chain when the plugin isn't installed; we ship the per-attempt DLX approach because CloudAMQP Tiger doesn't include the delayed-message plugin). Each consumer wraps its handler in `TenantTransactionService.runWithTenant` (from plan 02) and records its lifecycle in `pipeline_run`.

**Tech Stack:** `@golevelup/nestjs-rabbitmq`, `amqplib`.

**Reference:** `arc/02-queue-and-routines.md` §3–§7, §9.

---

## Interfaces Exposed

- **Module:** `QueueModule` (registers exchange/queue topology, publishers, consumers wiring).
- **Constants:** `src/queue/constants.ts` — exports `EXCHANGE_NAME`, `DLX_NAME`, `DELAY_EXCHANGE_NAME`, `RETRY_DELAYS_MS`, `MAX_ATTEMPTS`.
- **Types:**
  - `PipelineMessage<TPayload> { pipelineRunId, tenantId, step, attempt, publishedAt, payload }`
- **Services:**
  - `PipelinePublisher` — `publishStart(tenantId)`, `publishStep(step, message)`.
  - `PipelineRunService` — `start(pipelineRunId, tenantId, step, attempt)`, `complete(pipelineRunId, step)`, `fail(pipelineRunId, step, error)`, `isCompleted(pipelineRunId, step)`.
  - `RetryService` — `republishWithDelay(step, message, attempt)`.
- **Base class:** `BasePipelineConsumer<TPayload>` — extend per step. Subclasses implement `handle(message, em, integrationDs)`. The base handles search-path, idempotency check, retry, DLQ.
- **Routing keys:** `<tenantSlug>.<step>` (e.g. `acme.sync-base-product`).
- **Queues created:** 8 step queues + 8 DLQs + 1 `pipeline.start` queue + 1 `migrate-tenant` queue.
- **Env vars consumed:** `AMQP_URL`, `NODE_ENV` (used to name exchange `pipeline.<env>`).

---

## File Structure

```
src/queue/
├─ queue.module.ts
├─ constants.ts
├─ types.ts                            # PipelineMessage, helpers
├─ pipeline-publisher.service.ts
├─ pipeline-publisher.service.spec.ts
├─ pipeline-run.service.ts
├─ pipeline-run.service.spec.ts
├─ retry.service.ts
├─ retry.service.spec.ts
├─ base-pipeline.consumer.ts
└─ base-pipeline.consumer.spec.ts
```

---

### Task 1: Install RMQ deps

- [x] **Step 1: Install**

```bash
npm install @golevelup/nestjs-rabbitmq amqplib
npm install -D @types/amqplib
```

- [x] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(queue): install @golevelup/nestjs-rabbitmq + amqplib"
```

---

### Task 2: Constants and types

**Files:** `src/queue/constants.ts`, `src/queue/types.ts`

- [x] **Step 1: constants.ts**

```ts
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export const EXCHANGE_NAME = `pipeline.${process.env.NODE_ENV ?? 'development'}`;
export const DLX_NAME = `${EXCHANGE_NAME}.dlx`;
// Per-attempt delay queues: one queue per retry slot, all dead-lettering back to the main exchange.
export const DELAY_QUEUE = (ms: number): string => `${EXCHANGE_NAME}.retry.${ms}`;

export const RETRY_DELAYS_MS: ReadonlyArray<number> = [60_000, 5 * 60_000, 30 * 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;  // initial + 3 retries

export const STEP_QUEUES: ReadonlyArray<PipelineStep> = [
  PipelineStep.SYNC_BASE_PRODUCT,
  PipelineStep.SYNC_BASE_PRODUCT_STOCK,
  PipelineStep.SYNC_OFFER_BOOKS_INFO,
  PipelineStep.IMPORT_COMPETITOR_PRODUCTS,
  PipelineStep.IMPORT_COMPETITOR_STOCK,
  PipelineStep.CALC_BASE_PRODUCT_METRICS,
  PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES,
  PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT,
];

export const PIPELINE_START_QUEUE = 'pipeline.start';
export const MIGRATE_TENANT_QUEUE = 'migrate-tenant';

// Per-step prefetch — heavyweight / I/O / per-tenant constraints from arc/02 §3 "Workers".
export const STEP_PREFETCH: Readonly<Record<PipelineStep, number>> = {
  [PipelineStep.SYNC_BASE_PRODUCT]: 1,
  [PipelineStep.SYNC_BASE_PRODUCT_STOCK]: 1,
  [PipelineStep.SYNC_OFFER_BOOKS_INFO]: 2,
  [PipelineStep.IMPORT_COMPETITOR_PRODUCTS]: 4,
  [PipelineStep.IMPORT_COMPETITOR_STOCK]: 2,
  [PipelineStep.CALC_BASE_PRODUCT_METRICS]: 1,
  [PipelineStep.UPDATE_BASE_PRODUCT_PROPERTIES]: 1,
  [PipelineStep.UPDATE_ACTIVE_INGREDIENT_MAT]: 2,
};
```

- [x] **Step 2: types.ts**

```ts
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export interface PipelineMessage<TPayload = Record<string, unknown>> {
  pipelineRunId: string;
  tenantId: string;       // tenant slug (matches arc spec — slug carried in messages too)
  step: PipelineStep;
  attempt: number;
  publishedAt: string;    // ISO timestamp
  payload: TPayload;
}

export interface PipelineStartPayload {
  reason: 'cron' | 'manual';
  startedBy?: string;     // user id if manual
}

export function newPipelineMessage<P>(args: Omit<PipelineMessage<P>, 'attempt' | 'publishedAt'>): PipelineMessage<P> {
  return { ...args, attempt: 1, publishedAt: new Date().toISOString() };
}
```

- [x] **Step 3: Commit**

```bash
git add src/queue/constants.ts src/queue/types.ts
git commit -m "feat(queue): constants + PipelineMessage type"
```

---

### Task 3: PipelineRunService (idempotency + audit)

**Files:** `src/queue/pipeline-run.service.ts`, `.spec.ts`

This service writes/queries `core.pipeline_run` rows. Used by the base consumer to enforce single-flight per `(pipelineRunId, step)` and by the join logic (chain join — plan 05).

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PipelineRunService } from './pipeline-run.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

describe('PipelineRunService', () => {
  let svc: PipelineRunService;
  let repo: {
    findOne: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [PipelineRunService, { provide: getRepositoryToken(PipelineRunEntity), useValue: repo }],
    }).compile();
    svc = mod.get(PipelineRunService);
  });

  it('start: inserts a running row when none exists', async () => {
    repo.findOne.mockResolvedValue(null);
    repo.save.mockImplementation(async (x: PipelineRunEntity) => ({ ...x, id: 'id1' }));
    const result = await svc.start('run1', 'tid', PipelineStep.SYNC_BASE_PRODUCT, 1);
    expect(result).toBe('started');
    expect(repo.save).toHaveBeenCalled();
  });

  it('start: returns "already-completed" when a completed row exists', async () => {
    repo.findOne.mockResolvedValue({ status: 'completed' });
    const result = await svc.start('run1', 'tid', PipelineStep.SYNC_BASE_PRODUCT, 1);
    expect(result).toBe('already-completed');
  });

  it('start: returns "in-progress" when a running row exists', async () => {
    repo.findOne.mockResolvedValue({ status: 'running' });
    const result = await svc.start('run1', 'tid', PipelineStep.SYNC_BASE_PRODUCT, 1);
    expect(result).toBe('in-progress');
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/queue/pipeline-run.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import { PipelineRunStatus } from '../database/enums/pipeline-run-status.enum';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export type StartOutcome = 'started' | 'already-completed' | 'in-progress';

@Injectable()
export class PipelineRunService {
  constructor(
    @InjectRepository(PipelineRunEntity)
    private readonly repo: Repository<PipelineRunEntity>,
  ) {}

  public async start(
    pipelineRunId: string,
    tenantId: string,
    step: PipelineStep,
    attempt: number,
  ): Promise<StartOutcome> {
    const existing = await this.repo.findOne({ where: { pipelineRunId, step } });
    if (existing?.status === PipelineRunStatus.COMPLETED) return 'already-completed';
    if (existing?.status === PipelineRunStatus.RUNNING) return 'in-progress';
    await this.repo.save({
      pipelineRunId, tenantId, step, attempt,
      status: PipelineRunStatus.RUNNING,
      startedAt: new Date(),
    });
    return 'started';
  }

  public async complete(pipelineRunId: string, step: PipelineStep): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step },
      { status: PipelineRunStatus.COMPLETED, finishedAt: new Date() },
    );
  }

  public async fail(pipelineRunId: string, step: PipelineStep, error: string): Promise<void> {
    await this.repo.update(
      { pipelineRunId, step },
      { status: PipelineRunStatus.FAILED, finishedAt: new Date(), error: error.slice(0, 4000) },
    );
  }

  public async isCompleted(pipelineRunId: string, step: PipelineStep): Promise<boolean> {
    const row = await this.repo.findOne({ where: { pipelineRunId, step, status: PipelineRunStatus.COMPLETED } });
    return row !== null;
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/queue/pipeline-run.service.spec.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/queue/pipeline-run.service.ts src/queue/pipeline-run.service.spec.ts
git commit -m "feat(queue): PipelineRunService — start/complete/fail/isCompleted"
```

---

### Task 4: PipelinePublisher

**Files:** `src/queue/pipeline-publisher.service.ts`, `.spec.ts`

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

describe('PipelinePublisher', () => {
  let svc: PipelinePublisher;
  let amqp: { publish: jest.Mock };

  beforeEach(async () => {
    amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [PipelinePublisher, { provide: AmqpConnection, useValue: amqp }],
    }).compile();
    svc = mod.get(PipelinePublisher);
  });

  it('publishes a start message with routing key <slug>.pipeline.start', async () => {
    await svc.publishStart('acme', { reason: 'manual', startedBy: 'u1' });
    expect(amqp.publish).toHaveBeenCalledWith(
      expect.any(String),
      'acme.pipeline.start',
      expect.objectContaining({ tenantId: 'acme', step: 'pipeline.start' }),
    );
  });

  it('publishes a step message with routing key <slug>.<step>', async () => {
    await svc.publishStep({
      pipelineRunId: 'run1', tenantId: 'acme', step: PipelineStep.SYNC_BASE_PRODUCT, attempt: 1,
      publishedAt: new Date().toISOString(), payload: {},
    });
    expect(amqp.publish).toHaveBeenCalledWith(
      expect.any(String),
      'acme.sync-base-product',
      expect.objectContaining({ step: 'sync-base-product' }),
    );
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/queue/pipeline-publisher.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { randomUUID } from 'node:crypto';
import { EXCHANGE_NAME } from './constants';
import { PipelineMessage, PipelineStartPayload, newPipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

@Injectable()
export class PipelinePublisher {
  constructor(private readonly amqp: AmqpConnection) {}

  public async publishStart(tenantSlug: string, payload: PipelineStartPayload): Promise<string> {
    const pipelineRunId = randomUUID();
    const message: PipelineMessage<PipelineStartPayload> = newPipelineMessage({
      pipelineRunId,
      tenantId: tenantSlug,
      step: 'pipeline.start' as PipelineStep,   // routing only; not a real step
      payload,
    });
    await this.amqp.publish(EXCHANGE_NAME, `${tenantSlug}.pipeline.start`, message, { persistent: true });
    return pipelineRunId;
  }

  public async publishStep<P>(message: PipelineMessage<P>): Promise<void> {
    await this.amqp.publish(
      EXCHANGE_NAME,
      `${message.tenantId}.${message.step}`,
      message,
      { persistent: true },
    );
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/queue/pipeline-publisher.service.spec.ts`
Expected: PASS (2 tests).

- [x] **Step 5: Commit**

```bash
git add src/queue/pipeline-publisher.service.ts src/queue/pipeline-publisher.service.spec.ts
git commit -m "feat(queue): PipelinePublisher.publishStart/publishStep"
```

---

### Task 5: RetryService

**Files:** `src/queue/retry.service.ts`, `.spec.ts`

The retry strategy: when a consumer fails, it publishes the SAME message (with `attempt+1`) into a delay queue (`pipeline.<env>.retry.<delayMs>`). That queue has no consumers and an `x-message-ttl` equal to the delay; expired messages dead-letter into the main exchange with the original routing key, so they re-arrive at the step queue after the delay. After `MAX_ATTEMPTS`, the message is published directly to the step's DLQ.

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { RetryService } from './retry.service';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from './constants';

describe('RetryService', () => {
  let svc: RetryService;
  let amqp: { publish: jest.Mock };

  beforeEach(async () => {
    amqp = { publish: jest.fn().mockResolvedValue(undefined) };
    const mod = await Test.createTestingModule({
      providers: [RetryService, { provide: AmqpConnection, useValue: amqp }],
    }).compile();
    svc = mod.get(RetryService);
  });

  it('publishes to retry queue for attempt < MAX', async () => {
    const result = await svc.republishOnFailure({
      pipelineRunId: 'r', tenantId: 'acme', step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: 1, publishedAt: 'now', payload: {},
    });
    expect(result).toBe('retried');
    const call = amqp.publish.mock.calls[0];
    expect(call[1]).toBe('acme.sync-base-product');                 // routing preserved
    expect(call[3].expiration).toBe(String(RETRY_DELAYS_MS[0]));    // first delay
    expect(call[2].attempt).toBe(2);                                // bumped
  });

  it('publishes to DLQ when attempt >= MAX', async () => {
    const result = await svc.republishOnFailure({
      pipelineRunId: 'r', tenantId: 'acme', step: PipelineStep.SYNC_BASE_PRODUCT,
      attempt: MAX_ATTEMPTS, publishedAt: 'now', payload: {},
    });
    expect(result).toBe('dlq');
    expect(amqp.publish.mock.calls[0][0]).toMatch(/\.dlx$/);
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/queue/retry.service.spec.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DELAY_QUEUE, DLX_NAME, EXCHANGE_NAME, MAX_ATTEMPTS, RETRY_DELAYS_MS } from './constants';
import { PipelineMessage } from './types';

@Injectable()
export class RetryService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async republishOnFailure<P>(msg: PipelineMessage<P>): Promise<'retried' | 'dlq'> {
    const nextAttempt = msg.attempt + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
      await this.amqp.publish(DLX_NAME, `${msg.tenantId}.${msg.step}`, msg, { persistent: true });
      return 'dlq';
    }
    const delay = RETRY_DELAYS_MS[msg.attempt - 1];
    // Publish to the per-delay retry queue (declared in QueueModule below).
    // We use the default exchange ("") + routing key = queue name, with TTL `expiration`.
    // After expiry it dead-letters into EXCHANGE_NAME with the original routing key.
    await this.amqp.publish(
      '',                                  // default exchange (direct, by queue name)
      DELAY_QUEUE(delay),
      { ...msg, attempt: nextAttempt },
      {
        persistent: true,
        expiration: String(delay),         // per-message TTL
        headers: { 'x-original-routing-key': `${msg.tenantId}.${msg.step}` },
      },
    );
    return 'retried';
  }
}
```

> **Note on routing key preservation:** RabbitMQ preserves the original routing key when a message expires and is dead-lettered, **except** when the message was published with a different routing key. Because we publish into the retry queue with routing key `DELAY_QUEUE(delay)`, we configure that queue's DLX binding with `x-dead-letter-routing-key` set to the original step routing key — but the original routing key isn't known at queue-declare time. To work around this, we set `x-dead-letter-exchange` to the main exchange and leave `x-dead-letter-routing-key` unset; the broker then uses the message's current routing key (the queue name). Since that won't match `<slug>.<step>`, we instead **set the message's routing key in the header** and add a small shovel-style consumer.
>
> **Decision (simpler):** Use a fan-out delay topology — one delay queue per `(step, delay)` pair, with the queue's `x-dead-letter-routing-key` hard-coded to `<step>` and `x-dead-letter-exchange = EXCHANGE_NAME`. Since step queues are bound `*.<step>`, the broker matches any prefix. We need NxM delay queues (8 steps × 3 delays = 24) which is fine.
>
> Update the implementation:

Replace the retry block with:

```ts
import { Injectable } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { DLX_NAME, EXCHANGE_NAME, MAX_ATTEMPTS, RETRY_DELAYS_MS } from './constants';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export function delayQueueName(step: PipelineStep, delayMs: number): string {
  return `${EXCHANGE_NAME}.retry.${step}.${delayMs}`;
}

@Injectable()
export class RetryService {
  constructor(private readonly amqp: AmqpConnection) {}

  public async republishOnFailure<P>(msg: PipelineMessage<P>): Promise<'retried' | 'dlq'> {
    const nextAttempt = msg.attempt + 1;
    if (nextAttempt > MAX_ATTEMPTS) {
      await this.amqp.publish(DLX_NAME, `${msg.tenantId}.${msg.step}`, msg, { persistent: true });
      return 'dlq';
    }
    const delay = RETRY_DELAYS_MS[msg.attempt - 1];
    const queue = delayQueueName(msg.step, delay);
    await this.amqp.publish('', queue, { ...msg, attempt: nextAttempt }, { persistent: true });
    return 'retried';
  }
}
```

(Drop the earlier `DELAY_QUEUE(delay)` helper from `constants.ts` if you added it; the new helper is colocated with the service.)

- [x] **Step 4: Adjust the test to match the new `delayQueueName`**

In the test, update the assertion for the retry-queue routing key:

```ts
const call = amqp.publish.mock.calls[0];
expect(call[0]).toBe('');                                          // default exchange
expect(call[1]).toMatch(/\.retry\.sync-base-product\.60000$/);     // delay queue
expect(call[2].attempt).toBe(2);
```

Remove the `expiration` assertion (the broker enforces TTL on the queue declaration, not per message — declared in Task 7).

- [x] **Step 5: Run, expect pass**

Run: `npm test -- src/queue/retry.service.spec.ts`
Expected: PASS (2 tests).

- [x] **Step 6: Commit**

```bash
git add src/queue/retry.service.ts src/queue/retry.service.spec.ts src/queue/constants.ts
git commit -m "feat(queue): RetryService — per-(step,delay) DLX retry; DLQ at MAX_ATTEMPTS"
```

---

### Task 6: BasePipelineConsumer

**Files:** `src/queue/base-pipeline.consumer.ts`, `.spec.ts`

Subclasses (in plan 05) extend this and implement `handle(msg, em, integrationDs)`. The base:

1. Validates the message shape.
2. Calls `PipelineRunService.start()` for idempotency.
3. Runs `handle()` inside `runWithTenant(schemaName)`.
4. On success → `complete()` + publish successor(s) (subclass returns them).
5. On failure → `RetryService.republishOnFailure()`.

- [x] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import { BasePipelineConsumer, HandleResult } from './base-pipeline.consumer';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { TenantService } from '../tenant/tenant.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineStep } from '../database/enums/pipeline-step.enum';
import { PipelinePublisher } from './pipeline-publisher.service';

class TestConsumer extends BasePipelineConsumer<{ value: number }> {
  protected step = PipelineStep.SYNC_BASE_PRODUCT;
  public lastInvoked = 0;
  public failNext = false;

  protected async handle(): Promise<HandleResult> {
    this.lastInvoked++;
    if (this.failNext) throw new Error('boom');
    return { successors: [] };
  }
}

describe('BasePipelineConsumer', () => {
  let consumer: TestConsumer;
  let runs: { start: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let retry: { republishOnFailure: jest.Mock };
  let tx: { runWithTenant: jest.Mock };
  let tenants: { findActive: jest.Mock };
  let factory: { forTenantSlug: jest.Mock };
  let publisher: { publishStep: jest.Mock };

  beforeEach(async () => {
    runs = { start: jest.fn().mockResolvedValue('started'), complete: jest.fn(), fail: jest.fn() };
    retry = { republishOnFailure: jest.fn().mockResolvedValue('retried') };
    tx = { runWithTenant: jest.fn(async (_s, fn) => fn({} as EntityManager)) };
    tenants = { findActive: jest.fn().mockResolvedValue({ slug: 'acme', schemaName: 'tenant_acme', status: 'active' }) };
    factory = { forTenantSlug: jest.fn().mockResolvedValue(null) };
    publisher = { publishStep: jest.fn() };

    const mod = await Test.createTestingModule({
      providers: [
        TestConsumer,
        { provide: PipelineRunService, useValue: runs },
        { provide: RetryService, useValue: retry },
        { provide: TenantTransactionService, useValue: tx },
        { provide: TenantService, useValue: tenants },
        { provide: IntegrationDataSourceFactory, useValue: factory },
        { provide: PipelinePublisher, useValue: publisher },
      ],
    }).compile();
    consumer = mod.get(TestConsumer);
  });

  const msg = {
    pipelineRunId: 'run1', tenantId: 'acme', step: PipelineStep.SYNC_BASE_PRODUCT,
    attempt: 1, publishedAt: 'now', payload: { value: 1 },
  } as const;

  it('runs handle when start returns started', async () => {
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(1);
    expect(runs.complete).toHaveBeenCalledWith('run1', PipelineStep.SYNC_BASE_PRODUCT);
  });

  it('skips handle when start returns already-completed', async () => {
    runs.start.mockResolvedValue('already-completed');
    await consumer.process(msg);
    expect(consumer.lastInvoked).toBe(0);
    expect(runs.complete).not.toHaveBeenCalled();
  });

  it('on failure -> retry, on retry returning dlq -> fail row', async () => {
    consumer.failNext = true;
    await consumer.process(msg);
    expect(retry.republishOnFailure).toHaveBeenCalled();
    expect(runs.fail).toHaveBeenCalledWith('run1', PipelineStep.SYNC_BASE_PRODUCT, expect.stringContaining('boom'));
  });

  it('publishes successors returned by handle()', async () => {
    const successor = {
      pipelineRunId: 'run1', tenantId: 'acme', step: PipelineStep.SYNC_BASE_PRODUCT_STOCK,
      attempt: 1, publishedAt: 'now', payload: {},
    };
    (consumer as unknown as { handle: () => Promise<HandleResult> }).handle = async () => ({ successors: [successor] });
    await consumer.process(msg);
    expect(publisher.publishStep).toHaveBeenCalledWith(successor);
  });
});
```

- [x] **Step 2: Run, expect fail**

Run: `npm test -- src/queue/base-pipeline.consumer.spec.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { TenantService } from '../tenant/tenant.service';
import { TenantTransactionService } from '../tenant/tenant-transaction.service';
import { IntegrationDataSourceFactory } from '../integration/integration-data-source.factory';
import { PipelineMessage } from './types';
import { PipelineStep } from '../database/enums/pipeline-step.enum';

export interface HandleResult {
  successors: PipelineMessage[];
}

export interface HandleContext {
  message: PipelineMessage<unknown>;
  em: EntityManager;            // tenant-scoped (search_path set)
  integrationDs: DataSource | null;
}

@Injectable()
export abstract class BasePipelineConsumer<TPayload = unknown> {
  protected abstract readonly step: PipelineStep;
  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly runs: PipelineRunService,
    protected readonly retry: RetryService,
    protected readonly tx: TenantTransactionService,
    protected readonly tenants: TenantService,
    protected readonly integrationFactory: IntegrationDataSourceFactory,
    protected readonly publisher: PipelinePublisher,
  ) {}

  protected abstract handle(ctx: HandleContext): Promise<HandleResult>;

  public async process(message: PipelineMessage<TPayload>): Promise<void> {
    try {
      const outcome = await this.runs.start(message.pipelineRunId, message.tenantId, this.step, message.attempt);
      if (outcome === 'already-completed') {
        this.logger.debug(`Skipping ${this.step} for run ${message.pipelineRunId}: already completed`);
        return;
      }
      if (outcome === 'in-progress') {
        // Another worker already has this. Let RMQ redeliver later (NACK with requeue=false is handled by caller config).
        throw new Error(`In-progress lock held for ${this.step} run ${message.pipelineRunId}`);
      }

      const tenant = await this.tenants.findActive(message.tenantId);
      const integrationDs = await this.integrationFactory.forTenantSlug(tenant.slug);

      const result = await this.tx.runWithTenant(tenant.schemaName, (em) =>
        this.handle({ message: message as PipelineMessage<unknown>, em, integrationDs }),
      );

      await this.runs.complete(message.pipelineRunId, this.step);

      for (const successor of result.successors) {
        await this.publisher.publishStep(successor);
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`${this.step} failed for run ${message.pipelineRunId}: ${msg}`);
      const outcome = await this.retry.republishOnFailure(message);
      await this.runs.fail(message.pipelineRunId, this.step, `${msg} (retry=${outcome})`);
    }
  }
}
```

- [x] **Step 4: Run, expect pass**

Run: `npm test -- src/queue/base-pipeline.consumer.spec.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/queue/base-pipeline.consumer.ts src/queue/base-pipeline.consumer.spec.ts
git commit -m "feat(queue): BasePipelineConsumer with idempotency + retry + successor chain"
```

---

### Task 7: QueueModule — exchange + queues topology

**Files:** `src/queue/queue.module.ts`

Declares the topic exchange, every step queue + DLQ, every (step × delay) retry queue, and the pipeline.start / migrate-tenant queues. Auto-declared by `@golevelup/nestjs-rabbitmq` when its config lists them.

- [x] **Step 1: Implement**

```ts
import { Global, Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { PipelineRunEntity } from '../database/entities/core/pipeline-run.entity';
import {
  DLX_NAME, EXCHANGE_NAME, MIGRATE_TENANT_QUEUE, PIPELINE_START_QUEUE,
  RETRY_DELAYS_MS, STEP_QUEUES,
} from './constants';
import { delayQueueName } from './retry.service';
import { PipelinePublisher } from './pipeline-publisher.service';
import { PipelineRunService } from './pipeline-run.service';
import { RetryService } from './retry.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([PipelineRunEntity]),
    RabbitMQModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.amqpUrl,
        connectionInitOptions: { wait: true, timeout: 10_000 },
        exchanges: [
          { name: EXCHANGE_NAME, type: 'topic', options: { durable: true } },
          { name: DLX_NAME, type: 'topic', options: { durable: true } },
        ],
        queues: [
          // Step queues + bindings
          ...STEP_QUEUES.flatMap((step) => [
            {
              name: step,
              exchange: EXCHANGE_NAME,
              routingKey: `*.${step}`,
              createQueueIfNotExists: true,
              options: {
                durable: true,
                arguments: {
                  'x-dead-letter-exchange': DLX_NAME,
                  'x-dead-letter-routing-key': step,
                },
              },
            },
            // DLQ
            {
              name: `${step}.dlq`,
              exchange: DLX_NAME,
              routingKey: `*.${step}`,
              createQueueIfNotExists: true,
              options: { durable: true },
            },
            // Retry queues (one per delay slot, dead-letter back to main exchange)
            ...RETRY_DELAYS_MS.map((ms) => ({
              name: delayQueueName(step, ms),
              exchange: '',
              routingKey: delayQueueName(step, ms),
              createQueueIfNotExists: true,
              options: {
                durable: true,
                arguments: {
                  'x-message-ttl': ms,
                  'x-dead-letter-exchange': EXCHANGE_NAME,
                  // Re-route to the step queue. The wildcard binding *.<step> on the step queue will match.
                  'x-dead-letter-routing-key': `retry.${step}`,
                },
              },
            })),
          ]),
          {
            name: PIPELINE_START_QUEUE,
            exchange: EXCHANGE_NAME,
            routingKey: '*.pipeline.start',
            createQueueIfNotExists: true,
            options: { durable: true },
          },
          {
            name: MIGRATE_TENANT_QUEUE,
            exchange: EXCHANGE_NAME,
            routingKey: '*.migrate-tenant',
            createQueueIfNotExists: true,
            options: { durable: true },
          },
        ],
        // Wildcard binding for step queues — adapt the existing binding so retry-routed messages also match.
        // The *.<step> pattern already matches "retry.<step>", so no extra binding needed.
      }),
    }),
  ],
  providers: [PipelinePublisher, PipelineRunService, RetryService],
  exports: [PipelinePublisher, PipelineRunService, RetryService, RabbitMQModule],
})
export class QueueModule {}
```

- [x] **Step 2: Wire into AppModule and WorkerModule**

Modify both to import `QueueModule`. Publisher is used by both API (publishing) and worker (republishing on success → successors).

- [x] **Step 3: Smoke test the topology**

```bash
docker compose up -d rabbitmq postgres
npm run migration:run:app
# Start API to declare topology:
npm run start:dev &
sleep 4
# Verify in the management UI: http://localhost:15672 (guest/guest)
# Expect:
#  - exchanges: pipeline.development, pipeline.development.dlx
#  - queues: 8 step queues + 8 DLQs + 24 retry queues + pipeline.start + migrate-tenant
kill %1
```

- [x] **Step 4: Commit**

```bash
git add src/queue/queue.module.ts src/app.module.ts src/worker.module.ts
git commit -m "feat(queue): declare exchange + queue topology"
```

---

### Task 8: Verify publish + consume roundtrip with a stub consumer

Adds a temporary consumer that simply logs to verify the topology end-to-end. We'll remove it in plan 05 once real step consumers are wired.

**Files:** `src/queue/stub-consumer.ts` (temporary)

- [x] **Step 1: Stub consumer**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, PIPELINE_START_QUEUE } from './constants';

@Injectable()
export class StubPipelineStartConsumer {
  private readonly logger = new Logger(StubPipelineStartConsumer.name);

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: '*.pipeline.start',
    queue: PIPELINE_START_QUEUE,
  })
  public handle(msg: unknown): void {
    this.logger.log(`[stub] pipeline.start received: ${JSON.stringify(msg)}`);
  }
}
```

Register it in the worker module only:

```ts
// In src/worker.module.ts, add:
import { StubPipelineStartConsumer } from './queue/stub-consumer';

@Module({
  imports: [/* ... */],
  providers: [StubPipelineStartConsumer],
})
export class WorkerModule {}
```

- [x] **Step 2: Roundtrip**

```bash
# Terminal 1: worker
npm run build && WORKER_MODE=1 node dist/main.js
```

```bash
# Terminal 2: publish via a quick REPL script
cat <<'EOF' > /tmp/pub.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PipelinePublisher } from './src/queue/pipeline-publisher.service';

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.get(PipelinePublisher).publishStart('acme', { reason: 'manual' });
  await app.close();
})();
EOF
ts-node /tmp/pub.ts
```

Expected: worker logs `[stub] pipeline.start received: { ... tenantId: 'acme' ... }`.

- [x] **Step 3: Delete the stub (cleanup)**

```bash
rm src/queue/stub-consumer.ts
# remove the import + providers entry from src/worker.module.ts
```

- [x] **Step 4: Commit**

```bash
git add src/worker.module.ts
git commit -m "chore(queue): verify topology end-to-end (stub removed)"
```

---

## Exit Criteria

- [x] `npm run start:dev` declares exchange `pipeline.<env>` + 8 step queues + 8 DLQs + 24 retry queues + `pipeline.start` + `migrate-tenant`.
- [x] `PipelinePublisher.publishStart('acme', {...})` publishes a `PipelineMessage` to routing key `acme.pipeline.start`.
- [x] `BasePipelineConsumer.process()` skips already-completed work, runs new work inside a tenant-scoped transaction, and on failure calls `RetryService.republishOnFailure()`.
- [x] After `MAX_ATTEMPTS` failures, the message lands in `<step>.dlq`.
- [x] `pipeline_run` rows track `(pipelineRunId, step) -> status, attempt, started_at, finished_at, error`.
- [x] `import_process` is not referenced anywhere in the codebase.
- [x] `QueueModule` is `@Global()` — accessible to all feature modules (incl. plan 05's pipeline-steps module).
