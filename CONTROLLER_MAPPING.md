# Legacy → New Controller Mapping

Maps every HTTP route in [`legacy-app/src/controllers/`](./legacy-app/src/controllers/) to its place in the new app under [`src/`](./src/).

## What changed architecturally

The legacy app was a **single-tenant, synchronous product-management API**: each
"synchronize / import" was a long-running HTTP POST that did the work inline.

The new app is a **multi-tenant control plane + asynchronous pipeline**:

- **Multi-tenant** — every tenant-scoped route is under `/admin/tenants/:slug/...` and guarded by `SystemAdminGuard` + `@Roles('admin')`. Auth is mandatory (`/auth/login` → JWT); legacy had no auth.
- **Async pipeline** — the legacy `synchronize` / `import` POSTs are no longer HTTP work. They're RabbitMQ **pipeline steps** run by the **worker** (`src/main.worker.ts`), fanned out per batch. You don't call a step directly; you start a run (`POST /admin/tenants/:slug/pipeline/start`) or let the daily cron do it, and the step graph runs on the worker.
- **Observability over imperative status** — legacy `import-process/running` is replaced by run rows in `core.pipeline_run` and a DLQ admin surface.

## Legend

- ✅ **Ported** — direct HTTP equivalent exists today
- ▶️ **Triggerable routine** — runs as an async worker step; an admin can fire it on demand and in isolation via `POST /admin/tenants/:slug/pipeline/steps/:step`
- ❌ **Not yet ported** — no equivalent in the new app yet (future presentation-layer work)

---

## New HTTP surface (today)

| Method | Route | Controller |
|---|---|---|
| POST | `/auth/login` | `src/auth/auth.controller.ts` |
| POST | `/auth/refresh` | `src/auth/auth.controller.ts` |
| POST | `/auth/logout` | `src/auth/auth.controller.ts` |
| GET | `/auth/me` | `src/auth/auth.controller.ts` |
| GET | `/health` | `src/health/health.controller.ts` |
| POST | `/admin/tenants` | `src/admin/controllers/tenants.controller.ts` |
| GET | `/admin/tenants` | `src/admin/controllers/tenants.controller.ts` |
| GET | `/admin/tenants/:slug` | `src/admin/controllers/tenants.controller.ts` |
| PATCH | `/admin/tenants/:slug/status` | `src/admin/controllers/tenants.controller.ts` |
| DELETE | `/admin/tenants/:slug` | `src/admin/controllers/tenants.controller.ts` |
| PUT | `/admin/tenants/:slug/integration` | `src/admin/controllers/integration.controller.ts` |
| POST | `/admin/tenants/:slug/integration/test` | `src/admin/controllers/integration.controller.ts` |
| DELETE | `/admin/tenants/:slug/integration` | `src/admin/controllers/integration.controller.ts` |
| PUT | `/admin/tenants/:slug/competitor-origins` | `src/admin/controllers/competitor-origins.controller.ts` |
| POST | `/admin/tenants/:slug/pipeline/start` | `src/admin/controllers/pipeline.controller.ts` |
| GET | `/admin/tenants/:slug/pipeline/steps` | `src/admin/controllers/pipeline.controller.ts` |
| POST | `/admin/tenants/:slug/pipeline/steps/:step` | `src/admin/controllers/pipeline.controller.ts` |
| GET | `/admin/dlq/:step` | `src/admin/controllers/dlq.controller.ts` |
| POST | `/admin/dlq/:step/replay` | `src/admin/controllers/dlq.controller.ts` |
| POST | `/products/:ean/import` | `src/products/products.controller.ts` |

## Pipeline steps (worker)

Run by `src/main.worker.ts` consumers. Two ways to start them:
- **Whole graph** — `POST /admin/tenants/:slug/pipeline/start` (or the daily cron) runs every step in order, chaining successors.
- **One routine** — `POST /admin/tenants/:slug/pipeline/steps/:step` runs a single step **in isolation** (`standalone` flag suppresses its successors, so nothing downstream cascades). `GET …/pipeline/steps` lists the valid `:step` values.

| Step (`:step`) | Replaces (legacy) |
|---|---|
| `sync-base-product` | `POST /products/base/synchronize` (+ `/synchronize-active-ingredients`) |
| `sync-base-product-stock` | `POST /products/base/synchronize-stock` |
| `sync-offer-books-info` | `POST /offer-books/info/synchronize` |
| `import-competitor-products` | `POST /products/import/drogal`, `/import/drogasil` (all enabled origins) |
| `import-competitor-stock` | `POST /products/import/drogal/stock`, `/import/drogasil/stock` (all enabled origins) |
| `calc-base-product-metrics` | `POST /products/base/synchronize-metrics` |
| `update-base-product-properties` | `POST /products/base/generate-properties` |
| `migrate-tenant` | (new — per-tenant schema migration; not exposed as a routine trigger) |

---

## Per-controller mapping

### `app.controller.ts` → `health.controller.ts`

| Legacy | New | Status |
|---|---|---|
| `GET /health` | `GET /health` | ✅ |

### `base-product.controller.ts` (`/products/base`)

| Legacy | New | Status |
|---|---|---|
| `POST /products/base/run-daily-pipeline` | `POST /admin/tenants/:slug/pipeline/start` (whole graph) + `DailyPipelineCron` | ✅ |
| `POST /products/base/synchronize` | `…/pipeline/steps/sync-base-product` | ▶️ |
| `POST /products/base/synchronize-stock` | `…/pipeline/steps/sync-base-product-stock` | ▶️ |
| `POST /products/base/synchronize-metrics` | `…/pipeline/steps/calc-base-product-metrics` | ▶️ |
| `POST /products/base/synchronize-active-ingredients` | folded into `sync-base-product` step | ▶️ |
| `POST /products/base/generate-properties` | `…/pipeline/steps/update-base-product-properties` | ▶️ |
| `GET /products/base` | — | ❌ |
| `GET /products/base/:id` | — | ❌ |
| `PATCH /products/base/:id` | — | ❌ |
| `DELETE /products/base/:id` | — | ❌ |
| `GET /products/base/crossed` | — | ❌ |
| `GET /products/base/strategic-price` | — | ❌ |
| `GET /products/base/stock` | — | ❌ |
| `GET /products/base/stock-metrics` | — | ❌ |
| `GET /products/base/active-ingredients` | — | ❌ |
| `GET /products/base/active-ingredients/crossed` | — | ❌ |
| `GET /products/base/generic-missing-active-ingredients` | — | ❌ |
| `PATCH /products/base/generic-missing-active-ingredients/:id` | — | ❌ |
| `POST /products/base/import/csv` | — | ❌ |
| `DELETE /products/base/reset` | — | ❌ |
| `DELETE /products/base/reset-images` | — | ❌ |
| `POST /products/base/generate-description` | — | ❌ |
| `POST /products/base/generate-description/by-ids` | — | ❌ |
| `POST /products/base/generate-images` | — | ❌ |
| `POST /products/base/offers/:id` | — | ❌ |
| `DELETE /products/base/offers/:id` | — | ❌ |
| `POST /products/base/price/:id` | — | ❌ |

### `product.controller.ts` (`/products`)

| Legacy | New | Status |
|---|---|---|
| `POST /products/import/drogal` | `…/pipeline/steps/import-competitor-products` ¹ | ▶️ |
| `POST /products/import/drogasil` | `…/pipeline/steps/import-competitor-products` ¹ | ▶️ |
| `POST /products/import/drogal/stock` | `…/pipeline/steps/import-competitor-stock` ¹ | ▶️ |
| `POST /products/import/drogasil/stock` | `…/pipeline/steps/import-competitor-stock` ¹ | ▶️ |
| `GET /products/details/:ean` | `POST /products/:ean/import` | ✅ ² |
| `GET /products/export` | — | ❌ |

> ¹ The routine trigger is per-**step**, not per-origin: it fans out to all origins enabled for the tenant (`tenant_competitor_origin`). Legacy's per-vendor `/import/drogal` vs `/import/drogasil` granularity isn't reproduced — toggle origins via `PUT /admin/tenants/:slug/competitor-origins` instead.
>
> ² Synchronous single-EAN port of legacy `GetSingleProductUseCase`: live-scrapes every implemented origin (Drogal, Drogasil, Michelassi — Pague Menos/Ikesaki aren't ported), persists into `shared_catalog` (`product`, `product_image`, `product_stock`, `base_product`), and returns the merged cross-origin view. Touches the shared catalog only — no tenant data — so it's JWT-guarded but not tenant-scoped.

### `offer-book.controller.ts` (`/offer-books`)

| Legacy | New | Status |
|---|---|---|
| `POST /offer-books/info/synchronize` | `…/pipeline/steps/sync-offer-books-info` | ▶️ |
| `GET /offer-books/info` | — | ❌ |

### `offer-book-rules.controller.ts` (`/offer-book-rules`)

| Legacy | New | Status |
|---|---|---|
| `GET /offer-book-rules` | — | ❌ |
| `POST /offer-book-rules` | — | ❌ |
| `POST /offer-book-rules/preview` | — | ❌ |
| `POST /offer-book-rules/preview-download` | — | ❌ |
| `GET /offer-book-rules/execution-reports` | — | ❌ |
| `GET /offer-book-rules/execution-reports/:id` | — | ❌ |
| `GET /offer-book-rules/:id` | — | ❌ |
| `PATCH /offer-book-rules/:id` | — | ❌ |
| `DELETE /offer-book-rules/:id` | — | ❌ |
| `GET /offer-book-rules/:id/preview` | — | ❌ |
| `GET /offer-book-rules/:id/products` | — | ❌ |
| `GET /offer-book-rules/:id/preview-download` | — | ❌ |
| `POST /offer-book-rules/:id/execute` | — | ❌ |
| `GET /offer-book-rules/:id/execution-reports` | — | ❌ |

### `classification.controller.ts` (`/classifications`)

| Legacy | New | Status |
|---|---|---|
| `GET /classifications` | — | ❌ |
| `GET /classifications/grouped` | — | ❌ |

> Classifications are written by the `sync-base-product` step (tenant `classification` tree), but there's no read API yet.

### `configurations.controller.ts` (`/configurations`)

| Legacy | New | Status |
|---|---|---|
| `GET /configurations/price-rounding` | — | ❌ |
| `POST /configurations/price-rounding` | — | ❌ |
| `GET /configurations/price-rounding/:id` | — | ❌ |
| `PATCH /configurations/price-rounding/:id` | — | ❌ |
| `DELETE /configurations/price-rounding/:id` | — | ❌ |

### `scheduling.controller.ts` (`/scheduling`)

| Legacy | New | Status |
|---|---|---|
| `GET /scheduling` | — | ❌ |
| `GET /scheduling/:id` | — | ❌ |
| `POST /scheduling` | — | ❌ |
| `DELETE /scheduling/:id` | — | ❌ |

> The single daily run is now `DailyPipelineCron` (midnight UTC); per-tenant custom schedules aren't ported.

### `status-settings.controller.ts` (`/settings/variation-status`)

| Legacy | New | Status |
|---|---|---|
| `GET /settings/variation-status` | — | ❌ |
| `PATCH /settings/variation-status` | — | ❌ |

### `import-process.controller.ts` (`/import-process`)

| Legacy | New | Status |
|---|---|---|
| `GET /import-process/running` | run rows in `core.pipeline_run` (no HTTP read yet) | 🔄 |
| `DELETE /import-process/running` | DLQ: `GET/POST /admin/dlq/:step` | 🔄 |

---

## New surface with no legacy counterpart

These are genuinely new (multi-tenancy + ops), not migrations of legacy routes:

- `/auth/*` — JWT auth (legacy was unauthenticated)
- `/admin/tenants/*` — tenant onboarding/lifecycle
- `/admin/tenants/:slug/integration*` — per-tenant ERP connection
- `/admin/tenants/:slug/competitor-origins` — per-tenant competitor toggle
- `/admin/dlq/*` — dead-letter inspect/replay
