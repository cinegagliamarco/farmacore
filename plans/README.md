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

| # | Plan | Implements (arc doc) | Depends on |
|---|---|---|---|
| 00 | [00-foundation.md](./00-foundation.md) | — (project scaffold) | — |
| 01 | [01-database.md](./01-database.md) | `01-database-schema.md` | 00 |
| 02 | [02-auth-tenancy.md](./02-auth-tenancy.md) | `03-auth-and-tenancy.md` | 00, 01, 09 |
| 03 | [03-integration-data-source.md](./03-integration-data-source.md) | `04-integration-data-source.md` | 00, 01, 02 |
| 04 | [04-queue-infrastructure.md](./04-queue-infrastructure.md) | `02-queue-and-routines.md` (§3, §7) | 00, 01, 09 |
| 05 | [05-pipeline-steps.md](./05-pipeline-steps.md) | `02-queue-and-routines.md` (§3 graph, §5, §6) | 03, 04 |
| 06 | [06-admin-api.md](./06-admin-api.md) | `03-auth-and-tenancy.md` (§6, §7), `04-integration-data-source.md` (§5) | 02, 03, 04 |
| 07 | [07-observability.md](./07-observability.md) | `02-queue-and-routines.md` (§9) | 05, 09 |
| 08 | [08-provisioning.md](./08-provisioning.md) | `00-architecture.md`, `05-provisioning-tutorial.md` | — (parallel) |
| 09 | [09-presentation-layer.md](./09-presentation-layer.md) | (cross-cutting: interceptors, internal logger, signal listener, layering) | 00 |

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

08-provisioning  (parallel; required before first deploy)
```

## Suggested Order

1. **00-foundation** (solo, blocks everything code-side)
2. **09-presentation-layer** and **01-database** in parallel; **08-provisioning** can start any time
3. **02-auth-tenancy** and **04-queue-infrastructure** in parallel
4. **03-integration-data-source**
5. **05-pipeline-steps**
6. **06-admin-api**
7. **07-observability**

## Execution

Each plan is structured for [`superpowers:executing-plans`](https://github.com/anthropics/superpowers) (inline) or [`superpowers:subagent-driven-development`](https://github.com/anthropics/superpowers) (one subagent per task). Checkboxes track progress.

## Cross-Plan Contracts

Plans publish their interfaces (types, tables, queues, env vars) in their own `## Interfaces Exposed` section so dependent plans can refer to a stable contract.
