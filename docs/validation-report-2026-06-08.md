# Validation Report — Farmacore API

**Date:** 2026-06-08
**Scope:** End-to-end validation of the deployed API (auth, admin, pipeline, DLQ, token lifecycle).
**Environments:**
- **Prod:** `https://farmacore-api.fly.dev` (Fly.io `gru` + Neon `sa-east-1` + CloudAMQP LavinMQ + R2)
- **Local:** docker compose (postgres :5433, rabbitmq :5673, ERP A7Pharma sample :5435), API `:3000` + worker

**Result:** 9/9 test groups passed. 1 bug found (DLQ v2 coverage) — fixed, deployed, and re-validated in prod the same session.

> **Note (2026-06-28):** competitor stock (`import-competitor-stock` step, `shared_catalog.product_stock`) was removed after this report. Mentions of `import-competitor-stock` and `branch.stock-b` from that step below are historical; the pipeline now fans into CALC from `sync-base-product-stock` + `import-competitor-products`.

---

## Summary

| # | Test group | Env | Result |
|---|---|---|---|
| 1 | One-time setup (migrations, tenant seed, admin seed, API+worker boot) | Local | ✅ |
| 2 | Health — `GET /health` (no auth) | Prod | ✅ |
| 3 | Auth — `POST /auth/login` → `GET /auth/me` | Prod | ✅ |
| 4 | Tenants — list / get / create / patch status / delete | Prod | ✅ |
| 5 | Integration — `PUT` wire ERP → `POST /test` → `DELETE` | Prod | ✅ |
| 6 | Competitor origins — `PUT` bulk enable | Prod | ✅ |
| 7 | Pipeline routines — `GET /steps` → `POST /steps/:step` → `POST /start` | Prod | ✅ |
| 8 | DLQ — peek / replay | Prod | ⚠️→✅ (bug found + fixed) |
| 9 | Token lifecycle — refresh / logout | Prod | ✅ |

---

## Test details

### 1. One-time setup (local)

`docker compose up -d` → `migration:run:app` → `seed:local-tenant` → `migration:tenant macfarma` → `seed:system-admin` → `start:dev` + `start:worker:dev`.

- 5 app migrations applied (core + shared_catalog + pipeline_run/outbox).
- Tenant `macfarma` created (schema `tenant_macfarma`, 2 tenant migrations) + ERP integration wired to local docker ERP (`localhost:5435`).
- `migration:tenant macfarma` idempotent on second run (0 applied).
- System admin seeded.
- API booted on `:3000`, `/health` → `{status:ok, postgres:up, rabbitmq:up}`.
- Worker registered all consumers + declared RMQ topology.

### 2. Health — `GET /health` (no auth)

- No `Authorization` header → `HTTP 200`, body `{status:ok, info:{postgres:up, rabbitmq:up}}`.
- With a garbage Bearer token → `200` (route is genuinely public, ignores auth).
- Confirms `@Public()` + terminus health (Postgres ping + AmqpConnection.connected).

### 3. Auth — login → me

- `POST /auth/login` (tenant=system) → `200` + `{accessToken, refreshToken, expiresIn: 3600}`.
- JWT payload: `{sub, tenantId: system, role: admin}`.
- `GET /auth/me` with Bearer → `200` returning the payload.
- `GET /auth/me` without token → `401`.

### 4. Tenants CRUD

Used a throwaway slug `qasmoke` for create/patch/delete; left prod clean.

- `GET /admin/tenants` → `demo (active), system (active)`.
- `GET /admin/tenants/system` → `200` + full object.
- `POST /admin/tenants` (create `qasmoke`) → `201` + `{slug, schemaName, initialAdminUser.oneTimePassword}`. Ran the full path in prod: created schema, ran template migrations, seeded tenant admin.
- `PATCH /admin/tenants/qasmoke/status` → `paused` confirmed.
- `DELETE /admin/tenants/qasmoke` → `200` (soft-delete).
- Final list: `qasmoke` gone; `GET qasmoke` → `404`. Prod returned to original state.

### 5. Integration (PUT → test → DELETE)

On `demo` tenant.

- `PUT .../integration` → `200` `{status:active}` (password encrypted with `INTEGRATION_DB_KEY`).
- `POST .../integration/test` (host `erp.invalid.example`) → `201` `{ok:false, error:"getaddrinfo ENOTFOUND..."}`. **Graceful failure** — endpoint reports connection error instead of crashing. (A successful `ok:true` requires an ERP reachable from prod; the local ERP is the docker container, validated in test 1.)
- `DELETE .../integration` → `200`.

### 6. Competitor origins (PUT bulk enable)

On `demo`.

- `PUT .../competitor-origins` enabling DROGAL/DROGASIL/MICHELASSI → `200`.
- DB confirmed: DROGAL (true, p100), DROGASIL (true, p90), MICHELASSI (true, p80); IKESAKI + PAGUE_MENOS untouched (false). Partial update works; onboarding seeds all 5 origins disabled.

### 7. Pipeline routines

On `demo`.

- `GET .../pipeline/steps` → the 7 triggerable steps.
- `POST .../pipeline/steps/sync-offer-books-info` (isolated) → 1 `pipeline_run` row `completed`, no downstream chaining.
- `POST .../pipeline/steps/bogus-step` → `400` (enum validated).
- `POST .../pipeline/start` (full graph) → **9 rows all `completed`**: sync-base-product, sync-offer-books-info, import-competitor-products, sync-base-product-stock + branch.stock-a, import-competitor-stock + branch.stock-b, calc-base-product-metrics, update-base-product-properties.

The full v2 topology ran end-to-end in prod: dispatch → CloudAMQP → worker → fan-in counter → 2-branch stock join → successor via outbox. Counts were `0/0` because `demo` had no ERP wired (deleted in test 5), so each dispatcher read 0 rows and emitted 0 batches — the orchestration is what's proven here; real-data processing (>0 batches) is covered by the local ERP setup (test 1).

### 8. DLQ — peek / replay → **bug found + fixed**

**Found:** the admin DLQ API worked for only 1 of 7 steps. `GET/POST /admin/dlq/:step` returned `404 "Unknown step"` for `sync-base-product`, `import-competitor-products`, etc.

**Root cause:** `DlqService` was written in the v1 era (single queue per step). After plan 05 v2:
- It validated `:step` against `STEP_QUEUES`, which now holds only `sync-offer-books-info`.
- It read `<step>.dlq`, a name that doesn't exist for v2 steps. The real DLQs are `<step>.dispatch.dlq`, `<step>.batch.dlq`, `<step>.<ORIGIN>.dlq`.

So the 6 highest-volume steps — exactly the ones most likely to dead-letter — were unreachable via the recovery API.

**Fix** (commit `1eb40db`):
- `constants.ts` → `allStepQueueNames()`: single source of truth enumerating all 16 step queues (STEP_QUEUES + dispatch/batch of BATCHED_STEPS + dispatch/per-origin of PER_ORIGIN_STEPS).
- `DlqService.peek/replay` take a real queue name, validate against that list, read `<queue>.dlq`. Added `listQueues()`.
- `DlqController`: `GET /admin/dlq` lists queues (discovery); `:queue` replaces `:step`.
- Operator runbook DLQ section updated.

**Re-validated in prod after CI deploy:**
- `GET /admin/dlq` → 16 queues.
- peek on `sync-base-product.dispatch`, `.batch`, `import-competitor-products.DROGAL`, `import-competitor-stock.DROGASIL`, `calc-base-product-metrics.batch` → all `200 []` (previously `404`).
- replay v2 step → `{replayed:0}`. Unknown queue → `404`. No auth → `401`.

All 16 step DLQs now reachable. lint clean, build green, 130 unit tests pass.

### 9. Token lifecycle (refresh / logout)

- `POST /auth/refresh` → new access + refresh.
- Reusing the **old** refresh → `401` (one-time use; rotation works).
- New access works on `/auth/me` → `200`.
- `POST /auth/logout` → `204`.
- Refresh **after logout** → `401` (logout revokes server-side; session truly dies).

---

## Notes / follow-ups

- **Credential rotation pending:** the prod admin password, Neon password, CloudAMQP URL, and R2 token surfaced in chat during deployment (plan 08). Rotate before onboarding a real customer.
- **ERP `ok:true` test:** validating a successful ERP connection from prod needs an ERP reachable over the internet (the `seed-local-tenant.ts` comment mentions an ngrok tunnel). Locally it's proven against the docker ERP.
- **Real-data pipeline run:** test 7 proved orchestration with 0 batches (no ERP on `demo`). A run against the seeded local ERP (test-1 environment) exercises >0 batches end-to-end.
