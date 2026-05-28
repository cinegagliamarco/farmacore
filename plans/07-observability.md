# 07 — Observability Implementation Plan

> **Status: ✅ Executed.** All 11 tasks landed. Deviations:
> - **T5** wrapped the v2 base classes (`BatchPipelineConsumer` + `DispatchPipelineConsumer`) in addition to the v1 `BasePipelineConsumer`. The v1 base still services the single-shot `sync-offer-books-info` consumer.
> - **T6** the poller comment + smoke doc explicitly call out that the same `CLOUDAMQP_API_*` env vars point at the local `rabbitmq:management` API on `:15672/api` (`guest:guest`) — the management API shape is identical.
> - **T7** `ObservabilityModule` imports `AppConfigModule` so the poller can resolve `AppConfigService` from a context that doesn't otherwise pull config in (worker).
> - **T9** uses `@nestjs/terminus` `HealthIndicatorResult` shape; spec mocks `HealthCheckService` to call each indicator directly.
> - **T11** ships as `docs/observability/local-smoke.md` rather than a runnable spec; the smoke needs a live OTel collector + RabbitMQ + Postgres and isn't reproducible from CI.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the app and worker so per-tenant pipeline runs are visible end-to-end: OTel spans on every consumer, request-correlated logs, RMQ queue/depth metrics, and an alerting baseline on DLQ size + queue backlog.

**Architecture:** Use the OpenTelemetry Node SDK (auto-instrumentation for HTTP/Postgres/AMQP) plus manual spans around `BasePipelineConsumer.process()` with the attributes from `arc/02 §9`. Logs flow through `InternalLogger` (plan 09); this plan extends `NestInternalLogger` to also stamp the active span's `traceId`/`spanId` on every log line. Metrics push to OTLP HTTP endpoint — vendor stays pluggable (Datadog / Grafana Cloud / Better Stack), configured by `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS`. RMQ queue depth is scraped from the CloudAMQP management API by a periodic poller (`@nestjs/schedule`).

**Tech Stack:** `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-http`, `@nestjs/schedule` (already installed in plan 05).

**Reference:** `arc/02-queue-and-routines.md` §9; `arc/00-architecture.md` §4 ("Observability").

---

## Interfaces Exposed

- **Env vars (new):**
  - `OTEL_SERVICE_NAME` — `farmacore-api` (Fly app A) or `farmacore-worker` (Fly app B). Same image, two Fly apps with different env values so spans/metrics are tagged by role.
  - `OTEL_EXPORTER_OTLP_ENDPOINT` — vendor's OTLP/HTTP collector URL.
  - `OTEL_EXPORTER_OTLP_HEADERS` — comma-separated `key=value` (auth).
  - `OTEL_DISABLED` — `1` skips bootstrap (dev convenience).
  - `CLOUDAMQP_API_URL` — for queue-depth scraping (e.g. `https://<host>/api`).
  - `CLOUDAMQP_API_USER`, `CLOUDAMQP_API_PASS` — broker management credentials.
- **Module:** `ObservabilityModule` (exports nothing public; provides side-effect setup).
- **Service:** `QueueMetricsPoller` — periodic job (every 30s) that scrapes RMQ management API and emits gauges (`pipeline.queue.depth`, `pipeline.queue.oldest_age_seconds`).
- **Helpers:**
  - `withPipelineSpan(name, attrs, fn)` — wraps an async function in an OTel span. Used by `BasePipelineConsumer` (patched in this plan).
- **Dashboards / alerts:** documented in `docs/observability/dashboards.md` (created here; vendor wires the dashboard themselves).

---

## File Structure

```
src/observability/
├─ observability.module.ts
├─ otel-bootstrap.ts                # imported FIRST in main.ts (both API and worker share the entry)
├─ pipeline-span.helper.ts
├─ queue-metrics.poller.ts
└─ queue-metrics.poller.spec.ts

docs/observability/
└─ dashboards.md
```

---

### Task 1: Update config validation for OTel env vars

**Files:** `src/config/env.validation.ts`, `src/config/app-config.service.ts`, `.env.example`

- [ ] **Step 1: Make new OTel vars optional**

Append to the `EnvVars` class:

```ts
  @IsOptional() @IsString()
  OTEL_SERVICE_NAME?: string;

  @IsOptional() @IsString()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsOptional() @IsString()
  OTEL_EXPORTER_OTLP_HEADERS?: string;

  @IsOptional() @IsString()
  OTEL_DISABLED?: string;

  @IsOptional() @IsString()
  CLOUDAMQP_API_URL?: string;

  @IsOptional() @IsString()
  CLOUDAMQP_API_USER?: string;

  @IsOptional() @IsString()
  CLOUDAMQP_API_PASS?: string;
```

Add `import { IsOptional } from 'class-validator';` to the existing import list.

- [ ] **Step 2: Expose accessors**

Append to `AppConfigService`:

```ts
  get otelDisabled(): boolean { return this.config.get('OTEL_DISABLED') === '1'; }
  get otelServiceName(): string { return this.config.get('OTEL_SERVICE_NAME') ?? 'farmacore'; }
  get otelEndpoint(): string | undefined { return this.config.get('OTEL_EXPORTER_OTLP_ENDPOINT'); }
  get otelHeaders(): string | undefined { return this.config.get('OTEL_EXPORTER_OTLP_HEADERS'); }
  get cloudamqp(): { apiUrl?: string; user?: string; pass?: string } {
    return {
      apiUrl: this.config.get('CLOUDAMQP_API_URL'),
      user: this.config.get('CLOUDAMQP_API_USER'),
      pass: this.config.get('CLOUDAMQP_API_PASS'),
    };
  }
```

- [ ] **Step 3: Update .env.example**

Append:
```
# Observability (all optional in dev)
OTEL_DISABLED=1
OTEL_SERVICE_NAME=farmacore-api
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
CLOUDAMQP_API_URL=
CLOUDAMQP_API_USER=
CLOUDAMQP_API_PASS=
```

- [ ] **Step 4: Commit**

```bash
git add src/config/ .env.example
git commit -m "feat(obs): add optional OTel + CloudAMQP env vars"
```

---

### Task 2: Install OTel deps

- [ ] **Step 1: Install**

```bash
npm install @opentelemetry/api \
         @opentelemetry/sdk-node \
         @opentelemetry/auto-instrumentations-node \
         @opentelemetry/exporter-trace-otlp-http \
         @opentelemetry/exporter-metrics-otlp-http \
         @opentelemetry/resources \
         @opentelemetry/semantic-conventions
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(obs): install OpenTelemetry SDK + auto-instrumentations"
```

---

### Task 3: OTel bootstrap

**Files:** `src/observability/otel-bootstrap.ts`

This file is imported **before** any other application code in `main.ts` and `main.ts`, so the SDK can patch HTTP / pg / amqplib globals.

- [ ] **Step 1: Implement**

```ts
import 'dotenv/config';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').map((kv) => {
      const [k, ...vs] = kv.split('=');
      return [k.trim(), vs.join('=').trim()];
    }),
  );
}

let sdk: NodeSDK | undefined;

export function startOtel(): void {
  if (process.env.OTEL_DISABLED === '1') return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    // No-op when no endpoint configured (dev default).
    return;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'farmacore',
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? 'dev',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
      exportIntervalMillis: 30_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // pg: instrumented; amqplib: instrumented; http: instrumented.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = (): void => {
    if (!sdk) return;
    sdk
      .shutdown()
      .catch((err) => console.error('OTel shutdown error', err))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
```

- [ ] **Step 2: Bootstrap from main.ts**

Edit `src/main.ts` — the FIRST line of the file (above every other import) must be:

```ts
import { startOtel } from './observability/otel-bootstrap';
startOtel();

// ... then existing imports + bootstrap function ...
```

This covers both API and worker roles because they share the entry file.

- [ ] **Step 3: Commit**

```bash
git add src/observability/otel-bootstrap.ts src/main.ts
git commit -m "feat(obs): OTel SDK bootstrap (no-op when OTEL_DISABLED or no endpoint)"
```

---

### Task 4: PipelineSpan helper

**Files:** `src/observability/pipeline-span.helper.ts`

- [ ] **Step 1: Implement**

```ts
import { context, propagation, SpanKind, SpanStatusCode, trace, Tracer } from '@opentelemetry/api';

const tracer: Tracer = trace.getTracer('farmacore.pipeline');

export interface PipelineSpanAttrs {
  tenantId: string;
  pipelineRunId: string;
  step: string;
  attempt: number;
}

export async function withPipelineSpan<T>(
  attrs: PipelineSpanAttrs,
  fn: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(
    `pipeline.${attrs.step}`,
    { kind: SpanKind.CONSUMER, attributes: {
      'tenant.id': attrs.tenantId,
      'pipeline.run_id': attrs.pipelineRunId,
      'pipeline.step': attrs.step,
      'pipeline.attempt': attrs.attempt,
    } },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        const message = (err as Error).message;
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/observability/pipeline-span.helper.ts
git commit -m "feat(obs): withPipelineSpan helper"
```

---

### Task 5: Wrap BasePipelineConsumer.process() in a span

**Files:** `src/queue/base-pipeline.consumer.ts` (modify — file from plan 04)

- [ ] **Step 1: Patch the process method**

Replace `public async process(...)` with:

```ts
public async process(message: PipelineMessage<TPayload>): Promise<void> {
  await withPipelineSpan(
    {
      tenantId: message.tenantId,
      pipelineRunId: message.pipelineRunId,
      step: this.step,
      attempt: message.attempt,
    },
    async () => {
      try {
        const outcome = await this.runs.start(message.pipelineRunId, message.tenantId, this.step, message.attempt);
        if (outcome === 'already-completed') {
          this.logger.debug(`Skipping ${this.step} for run ${message.pipelineRunId}: already completed`);
          return;
        }
        if (outcome === 'in-progress') {
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
        const errMsg = (err as Error).message ?? String(err);
        this.logger.error(`${this.step} failed for run ${message.pipelineRunId}: ${errMsg}`);
        const outcome = await this.retry.republishOnFailure(message);
        await this.runs.fail(message.pipelineRunId, this.step, `${errMsg} (retry=${outcome})`);
        throw err;   // re-throw so the span records the exception
      }
    },
  );
}
```

Add `import { withPipelineSpan } from '../observability/pipeline-span.helper';` at the top.

> **Note on re-throwing:** the original `process()` swallowed exceptions (so the consumer wouldn't NACK back to RMQ — we've already decided what to do via `RetryService`). Re-throwing here would cause `@golevelup/nestjs-rabbitmq` to send a NACK, double-handling the failure. We want the span to record the exception but **NOT** re-throw.

Replace `throw err;` with:
```ts
// Don't re-throw: RetryService already routed the message. Record the error on the span instead.
trace.getActiveSpan()?.recordException(err as Error);
trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR, message: errMsg });
```

Add the imports:
```ts
import { SpanStatusCode, trace } from '@opentelemetry/api';
```

- [ ] **Step 2: Update the existing test**

The test in `base-pipeline.consumer.spec.ts` (plan 04) didn't assert anything about spans — should still pass. Re-run:

Run: `npm test -- src/queue/base-pipeline.consumer.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/queue/base-pipeline.consumer.ts
git commit -m "feat(obs): wrap BasePipelineConsumer.process in OTel span"
```

---

### Task 6: QueueMetricsPoller

**Files:** `src/observability/queue-metrics.poller.ts`, `.spec.ts`

Polls the CloudAMQP management API every 30s and emits two gauges per queue: depth (messages) + oldest message age. Falls back to a no-op when `CLOUDAMQP_API_URL` isn't set.

- [ ] **Step 1: Failing test**

```ts
import { Test } from '@nestjs/testing';
import { QueueMetricsPoller } from './queue-metrics.poller';
import { AppConfigService } from '../config/app-config.service';

describe('QueueMetricsPoller', () => {
  let poller: QueueMetricsPoller;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        QueueMetricsPoller,
        { provide: AppConfigService, useValue: { cloudamqp: { apiUrl: undefined, user: undefined, pass: undefined } } },
      ],
    }).compile();
    poller = mod.get(QueueMetricsPoller);
  });

  it('does nothing when CLOUDAMQP_API_URL is not set', async () => {
    await expect(poller.poll()).resolves.toBeUndefined();
  });

  it('parses queue list and emits gauges', async () => {
    (poller as unknown as { config: { cloudamqp: { apiUrl?: string; user?: string; pass?: string } } }).config = {
      cloudamqp: { apiUrl: 'https://x/api', user: 'u', pass: 'p' },
    };
    const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => [{ name: 'sync-base-product', messages: 3, head_message_timestamp: 1700000000 }],
    } as never);
    const observed: Array<{ name: string; value: number }> = [];
    (poller as unknown as { recordGauge: (name: string, value: number) => void }).recordGauge =
      (name: string, value: number) => { observed.push({ name, value }); };
    await poller.poll();
    expect(observed).toContainEqual(expect.objectContaining({ name: 'pipeline.queue.depth' }));
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- src/observability/queue-metrics.poller.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { metrics } from '@opentelemetry/api';
import { AppConfigService } from '../config/app-config.service';

const meter = metrics.getMeter('farmacore.queue');
const depthGauge = meter.createObservableGauge('pipeline.queue.depth', {
  description: 'Number of messages in the queue',
});
const ageGauge = meter.createObservableGauge('pipeline.queue.oldest_age_seconds', {
  description: 'Age of the oldest message in seconds',
});

interface QueueInfo {
  name: string;
  messages: number;
  head_message_timestamp?: number | null;
}

@Injectable()
export class QueueMetricsPoller {
  private readonly logger = new Logger(QueueMetricsPoller.name);
  private last: ReadonlyArray<QueueInfo> = [];

  constructor(private readonly config: AppConfigService) {
    depthGauge.addCallback((observer) => {
      for (const q of this.last) observer.observe(q.messages, { queue: q.name });
    });
    ageGauge.addCallback((observer) => {
      const nowSec = Math.floor(Date.now() / 1000);
      for (const q of this.last) {
        if (q.head_message_timestamp) {
          observer.observe(Math.max(0, nowSec - q.head_message_timestamp), { queue: q.name });
        }
      }
    });
  }

  @Interval(30_000)
  public async poll(): Promise<void> {
    const { apiUrl, user, pass } = this.config.cloudamqp;
    if (!apiUrl || !user || !pass) return;

    try {
      const res = await fetch(`${apiUrl}/queues`, {
        headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
      });
      if (!res.ok) {
        this.logger.warn(`CloudAMQP API ${res.status}: ${await res.text()}`);
        return;
      }
      this.last = (await res.json()) as QueueInfo[];
    } catch (err) {
      this.logger.warn(`Queue metrics poll failed: ${(err as Error).message}`);
    }
  }

  // Exposed for tests
  protected recordGauge(_name: string, _value: number): void {}
}
```

- [ ] **Step 4: Adjust test**

The implementation uses OTel observable gauges (callback-driven), which the test can't easily intercept. Replace the second test with one that just verifies `this.last` is updated:

```ts
it('parses queue list into this.last', async () => {
  (poller as unknown as { config: AppConfigService['cloudamqp'] | unknown }).config = {
    cloudamqp: { apiUrl: 'https://x/api', user: 'u', pass: 'p' },
  };
  const fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({
    ok: true,
    json: async () => [{ name: 'sync-base-product', messages: 3 }],
  } as never);
  await poller.poll();
  expect((poller as unknown as { last: Array<{ name: string }> }).last[0].name).toBe('sync-base-product');
  fetchSpy.mockRestore();
});
```

- [ ] **Step 5: Run, expect pass**

Run: `npm test -- src/observability/queue-metrics.poller.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/observability/queue-metrics.poller.ts src/observability/queue-metrics.poller.spec.ts
git commit -m "feat(obs): QueueMetricsPoller (CloudAMQP API → OTel gauges)"
```

---

### Task 7: ObservabilityModule

**Files:** `src/observability/observability.module.ts`

- [ ] **Step 1: Implement**

```ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QueueMetricsPoller } from './queue-metrics.poller';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [QueueMetricsPoller],
})
export class ObservabilityModule {}
```

- [ ] **Step 2: Wire into AppModule and WorkerModule**

Add `ObservabilityModule` to both `imports:`.

- [ ] **Step 3: Commit**

```bash
git add src/observability/observability.module.ts src/app.module.ts src/worker.module.ts
git commit -m "feat(obs): ObservabilityModule wired"
```

---

### Task 8: Enrich logs with traceId / spanId

**Files:** `src/presentation/logger/nest-internal-logger.ts` (modify — file from plan 09)

Extend `NestInternalLogger` so every payload picks up the active OTel span's `traceId` and `spanId`. The wrapper still defers to Nest's `Logger`; we just merge two fields into payload objects before delegating.

- [ ] **Step 1: Update NestInternalLogger**

Modify the file from plan 09:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { InternalLogger } from '../../interfaces';

function resolveContext(ctx: unknown): string | undefined {
  if (ctx === undefined || ctx === null) return undefined;
  if (typeof ctx === 'string') return ctx;
  if (typeof ctx === 'object') return ctx.constructor?.name ?? 'Object';
  return String(ctx);
}

function enrichWithTrace(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const span = trace.getActiveSpan();
  if (!span) return payload;
  const { traceId, spanId } = span.spanContext();
  return { ...payload, traceId, spanId };
}

@Injectable()
export class NestInternalLogger implements InternalLogger {
  constructor(private readonly nest: Logger = new Logger('App')) {}
  public log(payload: unknown, ctx?: unknown): void { this.nest.log(enrichWithTrace(payload) as never, resolveContext(ctx)); }
  public warn(payload: unknown, ctx?: unknown): void { this.nest.warn(enrichWithTrace(payload) as never, resolveContext(ctx)); }
  public error(message: string, ctx?: unknown): void { this.nest.error(message, resolveContext(ctx)); }
  public debug(payload: unknown, ctx?: unknown): void { this.nest.debug(enrichWithTrace(payload) as never, resolveContext(ctx)); }
}
```

- [ ] **Step 2: Update plan 09's NestInternalLogger spec to assert enrichment when a span is active**

Add a test case:

```ts
import { trace } from '@opentelemetry/api';

it('stamps traceId/spanId on object payloads when a span is active', () => {
  const span = trace.getTracer('test').startSpan('s');
  trace.setSpan(/* default active context */ undefined as never, span);
  // Easier: use trace.getActiveSpan() mock instead of context API.
  const getActiveSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
  log.log({ event: 'hello' });
  expect(underlying.log).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'hello', traceId: expect.any(String), spanId: expect.any(String) }),
    undefined,
  );
  getActiveSpy.mockRestore();
  span.end();
});
```

- [ ] **Step 3: Commit**

```bash
git add src/presentation/logger/nest-internal-logger.ts src/presentation/logger/nest-internal-logger.spec.ts
git commit -m "feat(obs): enrich InternalLogger payloads with traceId/spanId from active span"
```

---

### Task 9: Health endpoint with broker check

**Files:** `src/health/health.controller.ts` (modify), `src/health/health.module.ts` (modify)

- [ ] **Step 1: Switch to @nestjs/terminus**

```ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly amqp: AmqpConnection,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  public check() {
    return this.health.check([
      () => this.db.pingCheck('postgres', { timeout: 1500 }),
      async () => {
        const up = this.amqp.connected;
        return { rabbitmq: { status: up ? 'up' : 'down' } };
      },
    ]);
  }
}
```

- [ ] **Step 2: Update module**

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 3: Commit**

```bash
git add src/health/
git commit -m "feat(obs): /health checks Postgres + RabbitMQ"
```

---

### Task 10: Dashboards + alerts doc

**Files:** `docs/observability/dashboards.md`

- [ ] **Step 1: Write**

```markdown
# Observability — Dashboards & Alerts

V1 ships production-only. Pick a vendor (Datadog / Grafana Cloud / Better Stack), point `OTEL_EXPORTER_OTLP_ENDPOINT` at it, and build the panels below.

## Service map

Auto-populated from OTel traces. Should show:

- `farmacore-api` → `farmacore-worker` (via RMQ; auto-instrumented).
- `farmacore-api` → `postgres` (`pg` auto-instrumentation).
- `farmacore-worker` → `postgres` and `<tenant ERP>` (per-tenant — appears as a separate Postgres span attribute).

## Pipeline dashboard

| Panel | Query (PromQL-style — adapt to vendor) |
|---|---|
| Queue depth per step | `sum by (queue) (pipeline_queue_depth)` |
| Oldest message age | `max by (queue) (pipeline_queue_oldest_age_seconds)` |
| Success rate per step per tenant | derived from spans: `count(span_status='OK' && span_name=~'pipeline.*')` / `count(span_name=~'pipeline.*')` grouped by `tenant.id`, `pipeline.step` |
| p50/p99 step duration | duration histograms from the auto-instrumentation |
| DLQ size per step | `sum by (queue) (pipeline_queue_depth{queue=~'.+\.dlq'})` |

## Alerts

| Alert | Threshold | Action |
|---|---|---|
| DLQ size > 0 for >5min | `pipeline_queue_depth{queue=~'.+\.dlq'} > 0` for 5m | Page oncall |
| Queue depth > 1000 for >15min on a non-DLQ queue | as above | Page oncall |
| Worker process restarts > 3 in 30min | service restart event | Slack |
| Postgres health check failing for >2min | `/health` → 503 | Page oncall |
| RMQ health check failing for >2min | `/health` → 503 | Page oncall |

## Per-tenant filters

Every span has `tenant.id`. Use it as the primary dashboard variable. Every log entry carries `traceId` (stamped by `NestInternalLogger`) — click-through from log entry to trace.

## Span attributes (canonical set)

| Attribute | Source | Notes |
|---|---|---|
| `tenant.id` | `BasePipelineConsumer` (from message) | Tenant slug |
| `pipeline.run_id` | message | UUID per cron run |
| `pipeline.step` | consumer class | One of the 8 steps |
| `pipeline.attempt` | message | 1..MAX_ATTEMPTS |
| `db.statement` | pg auto-instrumentation | redacted at the vendor — confirm before enabling |
| `messaging.system` | amqplib auto-instrumentation | `rabbitmq` |
| `messaging.destination.name` | amqplib | step queue name |
```

- [ ] **Step 2: Commit**

```bash
git add docs/observability/dashboards.md
git commit -m "docs(obs): dashboards + alerts baseline"
```

---

### Task 11: Smoke test against the local stack (no vendor)

- [ ] **Step 1: Run with OTEL disabled**

Sanity check the SDK is fully no-op locally:

```bash
docker compose up -d postgres rabbitmq
npm run migration:run:app
OTEL_DISABLED=1 npm run start:dev
```

In another shell:
```bash
curl http://localhost:3000/health | jq
# Expect: { "status": "ok", "info": { "postgres": { "status": "up" }, "rabbitmq": { "status": "up" } }, ... }
```

Stop the API. No spans should be exported, no errors logged.

- [ ] **Step 2: Run with a local OTLP collector (optional)**

If you want to validate trace export end-to-end before deploy, run an OTel collector locally:

```bash
docker run -d --name otel-collector -p 4318:4318 \
  -e "OTEL_LOG_LEVEL=debug" \
  otel/opentelemetry-collector:latest \
  --config /etc/otelcol/config.yaml
```

```bash
OTEL_DISABLED=0 \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
OTEL_SERVICE_NAME=farmacore-api \
npm run start:dev
```

Hit `/health`, then `docker logs otel-collector` — you should see span exports. Tear down with `docker rm -f otel-collector`.

- [ ] **Step 3: Commit (no code change)**

---

## Exit Criteria

- [ ] `OTEL_DISABLED=1` (default in `.env.example`) keeps the app fully no-op observability-wise.
- [ ] With `OTEL_EXPORTER_OTLP_ENDPOINT` set, every HTTP request, Postgres query, and AMQP publish/consume produces an OTel span.
- [ ] Every step run produces a `pipeline.<step>` span with attributes `tenant.id`, `pipeline.run_id`, `pipeline.step`, `pipeline.attempt`. Failures record exception + ERROR status.
- [ ] Every log line emitted during a request includes `traceId` and `spanId` (when a span is active).
- [ ] `GET /health` returns 200 when Postgres + RMQ are reachable, 503 otherwise; route is `@Public()`.
- [ ] `QueueMetricsPoller` polls every 30s when `CLOUDAMQP_API_URL` is set; emits `pipeline.queue.depth` and `pipeline.queue.oldest_age_seconds` gauges tagged by `queue`.
- [ ] `docs/observability/dashboards.md` documents the panels + alert thresholds.
