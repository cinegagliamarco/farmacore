# 02 — Queue & Long-Running Routines

**Date:** 2026-05-12
**Status:** Draft

## 1. Purpose

Replace the prototype's serial, DB-lock-orchestrated daily pipeline with a **RabbitMQ-driven** pipeline that supports retries, per-step concurrency, observability, and a clean separation between the API service and the workers.

This is the refactor of `farmacore/src/cron/daily-routines.cron.ts` and the deletion of `farmacore/src/database/entities/import-process.entity.ts`.

## 2. The Prototype Today (Recap)

`daily-routines.cron.ts` runs every day at midnight:

1. `synchronizeBaseProduct` — ERP → `base_product` + `offer_book`
2. `synchronizeBaseProductStock`
3. `synchronizeOfferBooksInfo`
4. `importCompetitorProducts` (Michelassi, Drogal, Drogasil)
5. `importCompetitorStock` (Drogal, Drogasil)
6. `synchronizeBaseProductMetrics`
7. `generateBaseProductProperties`
8. `updateActiveIngredientMat`

Each step is `await`ed sequentially. Failure of one aborts the rest of the pipeline. The `import_process` table is used as a single-flight lock per step (`process_name` + `finished`).

Pain points:

- Hours of work serialized that don't strictly need to be.
- DB-lock orchestration is opaque; failure recovery requires manual SQL.
- No retries; a flaky scrape kills the whole pipeline.
- No per-step observability beyond `console.log`.
- The cron is hardcoded to "all tenants" — there is no tenant in the model.

## 3. Target Design

### Broker

- **CloudAMQP** managed RabbitMQ (Tiger plan, $19/mo, v1 sufficient).
- One **topic exchange** per environment: `pipeline.<env>` (e.g. `pipeline.prod`).
- Routing keys are dotted strings: `<tenant>.<step>`, e.g. `acme.sync-base-product`.
- Each step has **its own queue** bound to the exchange with the appropriate routing-key pattern (`*.<step>`).
- Each queue has a **DLQ**: `<step>.dlq`.

### Dependency graph (replaces the `daily-routines` table)

```
              ┌─────────────────────┐
              │  pipeline.start     │  (published by scheduler at cron time, per tenant)
              └──────────┬──────────┘
                         │ fan-out
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
 sync-base-product   sync-offer-books-info  (independent — run in parallel)
        │
        ▼
 sync-base-product-stock
        │
        ▼
 import-competitor-products
        │
        ▼
 import-competitor-stock
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

Steps publish their successor's message on successful completion. Parallel branches join implicitly — `calc-base-product-metrics` is only published once both `sync-base-product-stock` (chain A) and `import-competitor-stock` (chain B) have reported success for the same `pipelineRunId`. The join is tracked in `app_meta.pipeline_run`.

### Message shape

```json
{
  "pipelineRunId": "uuid-v4",
  "tenantId": "acme",
  "step": "sync-base-product",
  "attempt": 1,
  "publishedAt": "2026-05-12T03:00:00Z",
  "payload": { ... step-specific fields ... }
}
```

- `pipelineRunId` ties all messages in one tenant-day-run together.
- `attempt` increments on retry (see §5).
- `payload` is step-specific and small — large data stays in Postgres.

### Workers

- The **worker service** is a separate Fly app deployed from the same image as the API, with a different entry point (`main:worker`).
- It registers one consumer **per step queue**. NestJS `@golevelup/nestjs-rabbitmq` is already in the existing project's dependencies — same library.
- Per-step concurrency (prefetch) is tuned per step:
  - Heavy / CPU-bound steps (`calc-base-product-metrics`, `update-base-product-properties`): prefetch 1.
  - I/O-bound scraping steps (`import-competitor-products`): prefetch 2–4.
  - Stock sync steps: prefetch 1 per tenant (we don't want to flood the ERP DB).

## 4. Removing `import_process`

- Drop the `import_process` table and its repository.
- Replace its single-flight role with **per-step RMQ queues + idempotent step code**:
  - The step's first action is to record a row in `pipeline_run` (`status=running`) keyed by `(pipelineRunId, step)`.
  - If a row already exists with `status=completed`, the consumer **acks and returns** — duplicate-delivery handled.
  - If `status=running` and the run is younger than the visibility timeout, the consumer rejects (NACK with requeue=false), letting RMQ DLQ it. (Prevents two workers running the same step concurrently.)
- The `OnEvent` event-emitter wiring inside use-cases (the prototype's `SYNCHRONIZE_BASE_PRODUCT_USE_CASE` etc.) is replaced by RMQ consumer decorators.

## 5. Retries & Failure

- Each queue has a **per-message retry policy** via the headers exchange or RMQ delayed-message plugin:
  - Attempt 1 fails → republish with 1-minute delay (`attempt=2`).
  - Attempt 2 fails → 5-minute delay (`attempt=3`).
  - Attempt 3 fails → 30-minute delay (`attempt=4`).
  - Attempt 4 fails → message lands in `<step>.dlq` and an alert fires.
- Step code must be **idempotent**: upserts by natural keys, no destructive operations without a `pipelineRunId` guard.
- DLQ messages are inspected via a small admin endpoint on the API service (read-only listing + manual replay).

## 6. Scheduling

- The API service runs a single NestJS `@Cron` that, at the configured time, publishes one `pipeline.start` message per **active tenant** in `app_meta.tenant` where `status=active`.
- The cron schedule is configurable per-tenant in a future iteration (column `tenant.pipeline_cron`); for v1 it's a global "00:00 UTC".
- No worker runs the cron — only the API service. This avoids duplicate scheduling if we ever run multiple worker instances.

## 7. Tenant-Awareness

Every consumer:

1. Reads `tenantId` from the message.
2. Resolves the tenant's `schemaName` from `app_meta.tenant`.
3. Opens a transaction on the shared `appDataSource` and issues `SET LOCAL search_path = <schemaName>, shared_catalog, public;` as the first statement.
4. Looks up the tenant's ERP integration source from `app_meta.integration_database_connection` (see `04-integration-data-source.md`).
5. Executes the step body within that transaction.

A per-message **`TenantContext`** provider exposes `tenantId`, `schemaName`, `appDataSource` (single instance), and `integrationDataSource` (per-tenant, see `04-integration-data-source.md`).

## 8. Post-Deploy Migrator (replaces ad-hoc DB sync)

Because we now have many tenant schemas in one DB:

- After every deploy, a one-shot job (driven by RMQ: queue `migrate-tenant`) iterates all active tenants and runs pending tenant-template migrations against each `tenant_<slug>` schema.
- The migration runner sets `search_path = tenant_<slug>` and then applies pending migrations from `migrations/tenant/`.
- The job updates `app_meta.tenant_schema_version` on success.
- Concurrency cap: 10 tenants at a time.
- Failures land in the migrator's DLQ + alert.
- Migrations to `app_meta` and `shared_catalog` run once per deploy (before the tenant migrator), not per tenant.

## 9. Observability

- Every consumer wraps its handler in an OTel span.
- Span attributes: `tenant.id`, `pipeline.run_id`, `pipeline.step`, `pipeline.attempt`.
- A Datadog (or Grafana) dashboard shows: queue depth per step, oldest message age, success/failure rate per step per tenant, p50/p99 step duration.
- DLQ size is the primary alert; queue depth backing up beyond a threshold is the secondary alert.

## 10. Local Dev

- `docker compose up rabbitmq` runs a local broker for development.
- The same NestJS worker entry point can be started locally; consumers connect to the local broker.
- Optional `docker compose up neon-proxy` for connecting to a remote Neon branch; otherwise local Postgres is fine for app DBs.

## 11. Migration Path from the Prototype

Order of changes when implementing:

1. Stand up the CloudAMQP production instance and a local Docker RabbitMQ for development (no staging in v1 — see `00-architecture.md` §8).
2. Add `@golevelup/nestjs-rabbitmq` config in the new app.
3. Define one queue + consumer for `sync-base-product` as a vertical slice; verify end-to-end against a Neon branch.
4. Port the remaining 7 steps as separate consumers.
5. Wire chaining (success → publish next) and the parallel-branch join in `pipeline_run`.
6. Add the cron-driven `pipeline.start` publisher.
7. Delete the prototype's `daily-routines.cron.ts`, `periodic-routines.cron.ts`, and `import-process.*` files.

## 12. Open Questions

- Are any prototype steps idempotent-unsafe today (e.g. `offer_book.deleteAll()` inside `synchronizeBaseProduct`)? Identify and refactor before porting. **Action:** during implementation, audit each step.
- Do we need a tenant-level "pause pipeline" toggle? **Default: yes**, via `tenant.status` (`paused` consumers ack-and-skip).
- Should the `migrate-tenant` job run on every deploy or only on tagged releases? **Default for v1 (production-only):** run on every deploy to `main`. Add a tagged-release gate later if a staging environment is introduced.

## 13. Success Criteria

- All 8 steps run as independent RMQ consumers; the chained graph completes end-to-end for a single tenant against a Neon branch off production.
- A failure in step N retries up to 4 times, then DLQs; alert fires.
- Two tenants' pipelines run concurrently without interfering.
- The `import_process` table and entity are deleted from the codebase.
- Queue/step metrics are visible in the observability dashboard.
