# Postman walkthrough — the admin & pipeline core, end to end

Import [`farmacore.postman_collection.json`](./farmacore.postman_collection.json). Collection variables default to `baseUrl=http://localhost:3000`, `tenantSlug=acme`, `step=sync-base-product` — set `tenantSlug=macfarma` to follow this walkthrough against the seeded local tenant. Login stores the JWT automatically, so every other request just works.

This guided run covers the admin/pipeline core. The collection has much more (all 94 endpoints, including the tenant-facing catalog, stores, config and pricing folders) — [`../docs/api-reference.md`](../docs/api-reference.md) documents each one.

## 0. One-time local setup

```bash
docker compose up -d                 # postgres :5433, rabbitmq :5673, erp :5435 (auto-seeded A7Pharma sample)
npm run migration:run:app            # core + shared_catalog schemas
npm run seed:local-tenant            # macfarma tenant + ERP integration → local erp
npm run migration:tenant macfarma    # tenant schema incl. product identity columns
npm run seed:system-admin            # admin@system.local
npm run start:dev                    # API  (terminal 1)
npm run start:worker:dev             # worker (terminal 2) — runs the routines
```

Watch routine progress at any time:

```bash
docker exec farmacore-postgres-1 psql -U app -d app -c \
 "SELECT step,status,count(*) FROM core.pipeline_run
  WHERE pipeline_run_id='<RUN_ID>' GROUP BY step,status ORDER BY step;"
```

## 1. Health — no auth

**GET `/health`** → `{ "status": "ok" }`. Confirms the API is up.

## 2. Auth

1. **POST `/auth/login`** — body is the system admin (`admin@system.local` / `changeme-please-32-chars-or-more` / `tenantSlug: system`). The test script saves `accessToken` + `refreshToken` as collection vars. **Run this first** — everything below needs the token.
2. **GET `/auth/me`** → decoded `{ sub, tenantId: "system", role: "admin" }`.

## 3. Admin — Tenants

1. **GET `/admin/tenants`** → list (you'll see `macfarma` + `system`).
2. **GET `/admin/tenants/:slug`** → the `macfarma` row.
3. **POST `/admin/tenants`** → onboard a fresh tenant (body slug `acme`). Returns `initialAdminUser.oneTimePassword` — **save it** (shown once). Creates schema + migrations + competitor-origin rows.
4. **PATCH `/admin/tenants/:slug/status`** → flip status (`paused`/`active`/`suspended`).
5. **DELETE `/admin/tenants/:slug`** → soft-delete (sets suspended + `deleted_at`). *(Don't run on `macfarma` if you want to keep using it.)*

## 4. Admin — Integration (per tenant)

1. **PUT `/admin/tenants/:slug/integration`** — wires macfarma's ERP to the local `erp` container (`localhost:5435`). Password is AES-encrypted at rest. *(Already set by `seed:local-tenant`; this re-sets it.)*
2. **POST `/admin/tenants/:slug/integration/test`** → `{ "ok": true }` (connects + `SELECT 1`).
3. **DELETE `/admin/tenants/:slug/integration`** → disables it. *(Skip unless testing teardown — the routines need it.)*

## 5. Admin — Competitor origins (per tenant)

**PUT `/admin/tenants/:slug/competitor-origins`** — enables `DROGAL`, `DROGASIL`, `MICHELASSI`. **Required before the competitor scrape routine does anything** — with no enabled origins it's a no-op.

## 6. Admin — Pipeline routines (the main event)

This is what the worker runs. Two ways to drive it:

1. **GET `/admin/tenants/:slug/pipeline/steps`** → lists the triggerable routines:
   `sync-base-product`, `sync-base-product-stock`, `sync-offer-books-info`, `import-competitor-products`, `import-competitor-stock`, `calc-base-product-metrics`, `update-base-product-properties`.

2. **POST `/admin/tenants/:slug/pipeline/steps/:step`** — run ONE routine in isolation (no downstream cascade). Set the `step` collection var first. Returns `{ pipelineRunId, step }`. Suggested order to cover the paths:
   - `step = sync-base-product` → pulls the tenant's ERP products; creates `shared_catalog.base_product` (insert-only) + tenant `product`/`offer_book`. Verify with the psql query above (expect ~20 `sync-base-product` rows, all `completed`).
   - `step = import-competitor-products` → scrapes DROGAL/DROGASIL/MICHELASSI for the EAN universe (hits real sites — slower). Writes `shared_catalog.product`.
   - `step = calc-base-product-metrics` → margin/variation/status onto tenant `product`.
   - `step = update-base-product-properties` → backfills weight/dims (base_product) + supplier/name (tenant product).

3. **POST `/admin/tenants/:slug/pipeline/start`** — runs the WHOLE graph, chaining every step in dependency order (this is what the daily cron does). Returns `{ pipelineRunId }`. On a clean run you'll see all 8 step types + `branch.stock-a`/`branch.stock-b`, all `completed`.

## 7. Admin — DLQ (when a step fails)

Set the `step` var to the failing step first.

1. **GET `/admin/dlq/:step?limit=50`** → peek dead-lettered messages (doesn't consume).
2. **POST `/admin/dlq/:step/replay?max=100`** → re-publish them to the main exchange (`{ replayed: N }`).

## 8. Token lifecycle

1. **POST `/auth/refresh`** — rotates the refresh token (uses the stored `refreshToken`).
2. **POST `/auth/logout`** — revokes outstanding refresh tokens (204).

---

### Suggested full-coverage run

`health` → `login` → `me` → `tenants (GET list, GET macfarma)` → `integration test` → `competitor-origins PUT` → `pipeline/steps GET` → `pipeline/steps/sync-base-product` (watch run) → `pipeline/start` (watch full run) → `dlq GET` → `refresh` → `logout`. That touches every admin core route and every routine path; for the tenant-facing surface, follow [`../docs/api-reference.md`](../docs/api-reference.md).
