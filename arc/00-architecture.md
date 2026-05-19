# 00 — Overall Architecture

**Date:** 2026-05-12
**Status:** Draft

## 1. Context

A standalone prototype lives in `farmacore/`. It is a NestJS service that synchronizes a base-product catalog from an internal ERP database, scrapes competitor pharmacy sites for prices and stock, and serves offer-book pricing tooling. The whole pipeline is orchestrated as a single daily cron that runs eight steps in strict order, serialized through a DB-row lock (`import_process`).

We are extracting that prototype into a **new, standalone project** with these goals:

- Replace the cron-with-DB-lock orchestration with a **RabbitMQ-driven** queue pipeline so long-running steps can be retried, parallelized where safe, and observed independently.
- Add **multi-tenancy**: each customer (pharmacy) gets its own product DB. A **shared DB** holds the cross-tenant catalog of base products and competitor products.
- Add **JWT authentication**.
- Make the **integration source database configurable per tenant** instead of a hardcoded `INTEGRATION_DATABASE_URL`.
- Keep the cloud surface simple and extendable.

This document describes the **overall architecture and cloud choices**. Companion documents in this folder cover the database schema, the queue/routine refactor, auth + tenancy, and the integration data-source refactor.

## 2. Goals

- Long-running routines (hours-long jobs) run reliably, can resume on failure, and don't block each other unnecessarily.
- Multi-tenant with **schema-per-tenant** product data, and a shared schema for the cross-tenant base/competitor catalog — all within one Postgres database.
- JWT-based auth for API access; tenant identity resolved from the token.
- Integration ERP DB connection is **per tenant** and configured at runtime — no env-var hardcoding.
- Simple, cheap cloud stack that the team can extend.

## 3. Non-Goals

- Multi-region HA on day one.
- Real-time streaming (Kafka, Kinesis). RMQ is enough.
- Headless browsing / Puppeteer (Cheerio only).
- Migrating the existing `farmacore/` prototype in place — this is a greenfield rewrite.

## 4. Chosen Stack

| Layer | Service | Why |
|---|---|---|
| Compute | **Fly.io** | Container-based, Heroku-class DX, scale-to-zero, runs the same `Dockerfile` everywhere |
| Application database | **Neon (serverless Postgres)** | One DB, many schemas — `app_meta`, `shared_catalog`, `tenant_<slug>`. Cross-schema joins are native SQL |
| Connection pooling | **Neon's PgBouncer endpoint** | Required at any non-trivial tenant count |
| Message broker | **CloudAMQP** (managed RabbitMQ) | Real RMQ, $19/mo Tiger tier covers v1, no ops |
| Object storage | **Cloudflare R2** | S3-compatible, zero egress fees |
| Auth | **JWT** issued by the app | No external IdP for v1 |
| CI/CD | **GitHub Actions** → `flyctl deploy` | Standard, simple |
| Observability | OTel-compatible vendor (Datadog / Grafana Cloud / Better Stack) | Decide at first deploy |

### Alternatives considered (short form)

- **Heroku** — rejected. The original driver (DB-per-tenant blocked by add-on pricing) is moot now that we've chosen schema-per-tenant, but Heroku's Postgres is still pricier than Neon at our growth target and lacks branching for safe migration testing.
- **Self-hosted RabbitMQ on Fly** — viable as a cost-saver later (~$5–15/mo), but for v1 the managed offering is worth $19/mo to skip the ops.
- **Postgres-backed queue (`pg-boss`)** — simpler, but loses RMQ's routing/exchange model and worker isolation. We chose RMQ because the routines are heavyweight and benefit from dedicated worker pools per step.
- **AWS (App Runner / ECS + RDS + Amazon MQ)** — more expensive and much higher ops surface at this scale; see the AWS comparison at the end of this document.

## 5. High-Level Architecture

```
                       ┌─────────────────────────────┐
                       │   Clients / API consumers   │
                       │   (JWT-authenticated)       │
                       └─────────────┬───────────────┘
                                     │ HTTPS
                                     ▼
                       ┌─────────────────────────────┐
                       │     Fly.io: API service     │
                       │     (NestJS, Dockerfile)    │
                       │     /auth, /products, ...   │
                       └──┬───────┬──────────────┬───┘
                          │       │              │
              publishes   │       │ reads/writes │  publishes
              jobs        │       ▼              │  shared catalog reads
                          │   ┌─────────────────────────────┐
                          │   │   Neon DB: app-prod         │
                          │   │   schemas:                   │
                          │   │   ├─ app_meta (tenants...)  │
                          │   │   ├─ shared_catalog          │
                          │   │   ├─ tenant_acme             │
                          │   │   ├─ tenant_brand_x          │
                          │   │   └─ ...                     │
                          │   └─────────────────────────────┘
                          ▼
                ┌─────────────────────────┐
                │   CloudAMQP RabbitMQ     │◀──── consumed by ─────┐
                │   - sync-base-product    │                       │
                │   - sync-stock           │                       │
                │   - import-products      │            ┌─────────────────────────────┐
                │   - import-stocks        │            │     Fly.io: worker service  │
                │   - calc-metrics         │            │     (NestJS, same image)    │
                │   - update-properties    │            │     Long-running consumers  │
                │   - update-ai-mat        │            │     ┌───────────────────┐   │
                │   - DLQs per step        │            │     │ Per-step worker   │   │
                └─────────────────────────┘            │     │ pool (concurrency)│   │
                                                       │     └───────────────────┘   │
                                                       │            │                │
                                                       │            ▼                │
                                                       │  reads tenant ERP via       │
                                                       │  configurable integration   │
                                                       │  data source                │
                                                       └────┬────────────────────────┘
                                                            │
                                                            ▼
                                              ┌──────────────────────────┐
                                              │  Tenant ERP databases    │
                                              │  (configured per tenant) │
                                              └──────────────────────────┘
```

### Two Fly apps from one Docker image

- `app-api` — HTTP service. Handles auth, REST endpoints, publishes jobs to RMQ.
- `app-worker` — same image, different entry point. Consumes RMQ queues, runs long routines.

This keeps deploys atomic (same code on both sides) and lets us scale workers independently.

## 6. Tenancy Model

**One Neon database**, multiple **Postgres schemas**:

- **Schema `app_meta`** — tenant registry, integration-DB connection records (see `04-integration-data-source.md`), users, queue-job audit, schema versions.
- **Schema `shared_catalog`** — simplified `base_product` (EAN, description, active ingredient, generic flag, dimensions, weight) and **competitor products + stock + images for every origin** (Drogal, Drogasil, Pague Menos, Ikesaki, Michelassi, …). The scrape runs once per origin; every tenant reads the same canonical rows.
- **Schema `tenant_<slug>`** — one per tenant. Holds tenant-specific data: **classifications, active ingredients, offer-book metadata**, pricing rules, schedules, execution reports, status settings, tenant product overrides, and a **`tenant_competitor_origin`** config table that selects which competitor origins this tenant consumes (e.g. a new tenant enables DROGAL + DROGASIL and only sees those rows).

Tenant isolation is enforced by setting `search_path = tenant_<slug>, shared_catalog, public` at the start of every request/worker job. Cross-data joins between `shared_catalog.base_product` and `tenant_<slug>.pricing_rule` are native SQL — no cross-`DataSource` plumbing, no `postgres_fdw`.

**Why schema-per-tenant instead of DB-per-tenant:** we need to join shared catalog data with tenant data constantly (pricing decisions read both). DB-per-tenant forces those joins into application code or `postgres_fdw`; schema-per-tenant makes them flat SQL. We keep logical isolation, lose physical isolation. A single tenant outgrowing the shared DB is rare and has a clean migration path (`pg_dump` the schema, promote to its own DB).

Tenant resolution from a JWT claim (`tenantId`); detailed in `03-auth-and-tenancy.md`.

## 7. Routine Orchestration (Summary)

The old `daily-routines.cron.ts` runs steps 1–8 sequentially, gated by `import_process` rows. The new design:

- A **scheduler** publishes a `pipeline.start` message at the cron time (per tenant).
- Each step is a queue (`sync-base-product`, `sync-stock`, …) with its own consumer pool.
- Steps that **must** run after another publish their successor on completion (chained queues).
- Steps that can run in parallel are fan-out from a single `pipeline.start` message.
- The `import_process` table is **deleted**. Idempotency is enforced by per-tenant job IDs + RMQ's at-least-once delivery + idempotent upserts in step code.

Full design in `02-queue-and-routines.md`.

## 8. Cost

V1 ships **production-only** — no separate staging environment. Pre-production testing uses Neon **branches** off the production DB (copy-on-write, free) and short-lived feature branches on Fly.

| Item | Plan | Monthly |
|---|---|---|
| Fly.io `app-api` (`shared-cpu-1x@1GB`, 24/7) | Pay-as-you-go | ~$5 |
| Fly.io `app-worker` (`shared-cpu-2x@2GB`, 24/7) | Pay-as-you-go | ~$15 |
| Neon Scale plan (1,000 DBs, 50GB included) | $69 + usage | $69–100 |
| CloudAMQP Tiger (shared, 100 conns, 1M msgs/mo) | $19 | $19 |
| Cloudflare R2 | Pay-as-you-go, no egress | ~$5 |
| **Total** | | **~$115–145/mo** |

## 9. AWS Comparison

AWS can run this. The reason it isn't the v1 pick is operational surface area, not capability.

| Need | Chosen | AWS equivalent | Notes |
|---|---|---|---|
| Containers | Fly.io | **App Runner** or **ECS Fargate + ALB** | App Runner is the PaaS-like option; Fargate needs VPC/IAM/ALB wiring |
| Postgres | Neon | **Aurora Serverless v2** or **RDS Postgres** | RDS hosts many DBs per instance but compute doesn't scale per-DB; Aurora SLS v2 has a floor cost (≥0.5 ACU ≈ $43/mo) and never fully scales to zero |
| Connection pool | Neon PgBouncer endpoint | **RDS Proxy** | +$15–30/mo |
| RabbitMQ | CloudAMQP | **Amazon MQ for RabbitMQ** | ~$30–50/mo min |
| Storage | R2 | **S3** | S3 charges $0.09/GB egress (R2 is free) |
| Networking | None | **VPC, subnets, NAT Gateway, SGs** | NAT Gateway alone ≈ $32/mo + traffic |

### Rough cost at the same scale

| Stack | Monthly (prod) |
|---|---|
| **Chosen (Fly + Neon + CloudAMQP + R2)** | **~$115–145** |
| AWS (App Runner + Aurora SLS v2 + Amazon MQ + S3) | ~$220–320 + egress |
| AWS (ECS Fargate + RDS + Amazon MQ + S3) | ~$240–350 + egress |

AWS lands 60–150% more expensive at this scale before NAT / S3 egress / CloudWatch are counted.

### When to revisit AWS

- Compliance / data-residency requirements that the chosen vendors can't satisfy.
- Existing AWS investment at the company (Terraform modules, shared accounts, security review).
- A single tenant's load outgrows Neon's largest compute *and* a dedicated Neon project is no longer enough.
- Need for AWS-only services (SageMaker, Kinesis, Athena, etc.).

## 10. Companion Documents

| # | File | Topic |
|---|---|---|
| 00 | `00-architecture.md` (this file) | Overall architecture, cloud, costs, AWS comparison |
| 01 | `01-database-schema.md` | Simplified `base_product` + shared/per-tenant schema layout |
| 02 | `02-queue-and-routines.md` | RMQ refactor of the daily pipeline; removal of `import_process` |
| 03 | `03-auth-and-tenancy.md` | JWT auth, tenant resolution, DB routing |
| 04 | `04-integration-data-source.md` | `integration_database_connection` table; per-tenant ERP source |
| 05 | `05-provisioning-tutorial.md` | Step-by-step provisioning guide (CLI + Terraform) for every resource |

## 11. Open Questions

- Exact RMQ topology — single direct exchange or one topic exchange? Decided in `02-queue-and-routines.md`.
- Whether tenant slugs are user-chosen or system-generated — decided in `03-auth-and-tenancy.md`.
- Storage of integration-DB credentials (Neon? Doppler? Fly secrets?) — decided in `04-integration-data-source.md`.

## 12. Success Criteria

- New Fly app (`app-api` + `app-worker`) deployed, serving HTTPS, consuming RMQ.
- A tenant can be onboarded via API: new `tenant_<slug>` schema created, integration-DB connection recorded, pipeline runs end-to-end via RMQ.
- The original `daily-routines.cron.ts` 8-step pipeline runs to completion **without** an `import_process` lock, with per-step retries.
- JWT-protected endpoints reject unauthenticated calls and route to the correct tenant schema via `search_path`.
- Production cost under $200/mo at first tenant cohort.
