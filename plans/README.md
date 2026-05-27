# Implementation Plans

Execution plans for the architecture in [`../arc/`](../arc/). One plan per independently shippable slice. Each plan is self-contained, written so a fresh engineer (or subagent) can execute it without reading the others.

## Legacy reference

[`../legacy-app/`](../legacy-app/) holds the previous implementation. Its files are the source material being **replicated and refactored** into this project — not lift-and-shift. When a plan touches a concept that already exists in legacy (entities, controllers, services, use-cases, cron jobs, integration interfaces, migrations), consult the corresponding legacy file for domain logic, field names, business rules, and edge cases the plan does not spell out. The new structure (per-feature modules, presentation layer, queues/routines, multi-tenancy, internal logger) is defined by the plans and `arc/` — copy *behavior*, not structure.

Notable subtrees under `legacy-app/src/`:

- `controllers/`, `services/`, `use-cases/` — request handlers and domain logic
- `database/entities/`, `database/integration-entities/` — TypeORM entities (core + per-integration)
- `database/repositories/`, `database/integration-repositories/` — data access
- `database/migrations/` — historical migrations (do not copy directly; plan 01 owns the new schema)
- `interfaces/{drogal,drogasil,michelassi,ikesaki,pague-menos}/` — per-integration adapters; plans 03 and 05 govern how these are reorganized
- `cron/`, `dto/`, `common/`, `main.ts`, `app.module.ts` — supporting code

## Conventions (applied across all plans)

- **Package manager:** **npm** (not pnpm).
- **Entry files:** two files — `src/main.http.ts` (API: full Nest app, listens on HTTP) and `src/main.worker.ts` (worker: `ApplicationContext`, no HTTP, runs RMQ consumers). Same Docker image; the worker Fly app overrides `CMD` to `node dist/main.worker.js`. `main.worker.ts` sets `process.env.WORKER_MODE='1'` so the `DailyPipelineCron` guard keeps the cron API-only.
- **Logger:** internal abstraction `InternalLogger` (interface + DI token `INTERNAL_LOGGER_TOKEN`) backed by Nest's built-in `Logger`. No third-party logger lib for v1.
- **Core schema name:** `core` (replaces `arc/` doc's `app_meta`). All references in the plans use `core`.
- **No `tenant_schema_version` table** — TypeORM's per-schema `migrations_tenant` table tracks applied migrations.

## Plans

| # | Plan | Status | Implements (arc doc) | Depends on |
|---|---|---|---|---|
| 00 | [00-foundation.md](./00-foundation.md) | ✅ executed (amended: split `main.ts` → `main.http.ts` + `main.worker.ts`) | — (project scaffold) | — |
| 01 | [01-database.md](./01-database.md) | ✅ executed (amended: `external_id` moved to `tenant_base_product`; `pipeline_run.tenant_id` → text; `integration_database_connection.origin` added; **plan 05 v2/B1**: `tenant_base_product` → `tenant_product` with ERP columns: name, active, price, cost, average_unit_cost, unit_sale_price, supplier, receipt_date, monitored, classification_id (FK), deals jsonb; **plan 05 v2/A**: `pipeline_run` gains `batch_seq`/`batches_planned`/`batches_done` + UNIQUE swapped to (run_id, step, batch_seq); **plan 05 v2/B2**: new tables `tenant_subsidiary` (external_id unique, name, active) and `tenant_product_stock` (ean, subsidiary_external_id, quantity; unique on ean+subsidiary); **plan 05 v2 review fixes**: classification partial UNIQUE indexes (UQ_CLASSIFICATION_ROOT_NAME / _CHILD_NAME); **plan 05 v2/B3**: new table `tenant_offer_campaign` (external_id unique, name, active, start_date, expiration_date) — tenant-wide ERP campaign catalog) | `01-database-schema.md` | 00 |
| 02 | [02-auth-tenancy.md](./02-auth-tenancy.md) | ✅ executed (deviation: `SearchPathInterceptor` no longer injects request-scoped `TenantContext`) | `03-auth-and-tenancy.md` | 00, 01, 09 |
| 03 | [03-integration-data-source.md](./03-integration-data-source.md) | ✅ executed (ERP compose port `5435`; placeholder entity replaced by 14 A7Pharma entities under per-vendor folder; **per-tenant integration — each row's `origin` drives the entity set loaded**, different tenants can use different vendors) | `04-integration-data-source.md` | 00, 01, 02 |
| 04 | [04-queue-infrastructure.md](./04-queue-infrastructure.md) | ✅ executed (prefetch moved to `channels:`; `import type` for `PipelineMessage`; `createQueueIfNotExists:false`) | `02-queue-and-routines.md` (§3, §7) | 00, 01, 09 |
| 05 | [05-pipeline-steps.md](./05-pipeline-steps.md) | ✅ v1 stubs executed (e2e green — 10 rows per run, join fires once). ⚠ **v2 pending**: replace stub `handle()` bodies with the real legacy work using the **dispatcher/batch** pattern from [`notes/pipeline-throughput.md`](./notes/pipeline-throughput.md) (per-origin scrape queues; fan-in counter replaces two-branch join). | `02-queue-and-routines.md` (§3 graph, §5, §6) | 03, 04 |
| 06 | [06-admin-api.md](./06-admin-api.md) | ✅ executed (e2e green) | `03-auth-and-tenancy.md` (§6, §7), `04-integration-data-source.md` (§5) | 02, 03, 04 |
| 07 | [07-observability.md](./07-observability.md) | ⏳ pending | `02-queue-and-routines.md` (§9) | 05, 09 |
| 08 | [08-provisioning.md](./08-provisioning.md) | ⚙️ artifacts committed; **cloud execution deferred to LAST** — do not run until plan 05 v2 + plan 07 are done (see [`docs/provisioning/first-deploy.md`](../docs/provisioning/first-deploy.md)) | `00-architecture.md`, `05-provisioning-tutorial.md` | **last** (after 05 v2 + 07) |
| 09 | [09-presentation-layer.md](./09-presentation-layer.md) | ✅ executed (`AmqpInterceptor` later guarded for `@golevelup`) | (cross-cutting: interceptors, internal logger, signal listener, layering) | 00 |

## Dependency Graph

```
00-foundation ──► 09-presentation-layer ──┬──► 02-auth-tenancy ──┬──► 06-admin-api
                                          │                     │
00-foundation ──► 01-database ────────────┤                     │
   │                                      │                     │
   │            ┌─────────────────────────┘                     │
   ▼            ▼                                               │
   ├──► 03-integration-data-source ──────────────────────────────┤
   │                                                            │
   └──► 04-queue-infrastructure ──► 05-pipeline-steps ──────────┘
                                       │
                                       └──► 07-observability

08-provisioning  (LAST — do not execute cloud steps until everything else is done locally)
```

## Suggested Order

> **Cloud comes last.** Fly.io, CloudAMQP, and Neon — all the paying-cloud-vendor work in plan 08 — is deferred until every other plan is green locally. The plan 08 in-repo artifacts (`fly.api.toml`, `fly.worker.toml`, `.github/workflows/*`, `docs/provisioning/*`, `tsconfig.scripts.json`) are already committed and code-reviewable; only the cloud-side execution (account setup, secrets, first `fly deploy`, GitHub `FLY_API_TOKEN`) is held back. Push to remote only after plan 05 v2 + plan 07 land.

1. **00-foundation** (solo, blocks everything code-side)
2. **09-presentation-layer** and **01-database** in parallel
3. **02-auth-tenancy** and **04-queue-infrastructure** in parallel
4. **03-integration-data-source**
5. **05-pipeline-steps v1** (stub consumers, queue topology proven end-to-end)
6. **06-admin-api**
7. **05-pipeline-steps v2** — port real legacy work using the dispatcher/batch design ([`notes/pipeline-throughput.md`](./notes/pipeline-throughput.md))
8. **07-observability**
9. **08-provisioning** — execute the cloud steps (see [`docs/provisioning/first-deploy.md`](../docs/provisioning/first-deploy.md))

## Execution

Each plan is structured for [`superpowers:executing-plans`](https://github.com/anthropics/superpowers) (inline) or [`superpowers:subagent-driven-development`](https://github.com/anthropics/superpowers) (one subagent per task). Checkboxes track progress.

## Cross-Plan Contracts

Plans publish their interfaces (types, tables, queues, env vars) in their own `## Interfaces Exposed` section so dependent plans can refer to a stable contract.
