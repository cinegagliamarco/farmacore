# Postman collection

`farmacore.postman_collection.json` is the canonical Postman v2.1 collection for the Farmacore HTTP API. It is hand-curated and kept in sync with `plans/` — every plan that introduces, renames, or removes a controller route must update this file in the same commit.

## Sync rule

For each plan that touches `*.controller.ts`:

1. Add / update the request in the matching folder (`Health`, `Auth`, future `Admin`, etc.).
2. Set `auth` per route — public routes use `{ "type": "noauth" }`; protected routes inherit collection-level Bearer.
3. Reference the controller file in the request `description` (`Plan 02 — src/auth/auth.controller.ts`).
4. If the request returns a token (login, refresh), add a Tests script that stores it as a collection variable.

## Variables

| key            | default                  | purpose                                          |
| -------------- | ------------------------ | ------------------------------------------------ |
| `baseUrl`      | `http://localhost:3000`  | API base. Override for staging/prod.             |
| `tenantSlug`   | `acme`                   | Default tenant slug used in tenant-scoped routes. |
| `accessToken`  | (set by login/refresh)   | JWT bearer; auto-populated by the login test.    |
| `refreshToken` | (set by login/refresh)   | Refresh token; auto-populated by the login test. |
| `applyRunId`   | (paste from an apply run)| Used by `/pricing/apply/:id*` routes.            |
| `scheduleId`   | (paste from a schedule)  | Used by `/pricing/schedules/:id` routes.         |

## Local quickstart

```bash
docker compose up -d
npm run migration:run:app
npm run tenant:create acme || true
SEED_ADMIN_PASSWORD=devpassword-please-change npm run seed:system-admin
npm run start:dev
```

Then import `postman/farmacore.postman_collection.json` into Postman and run:

1. `Auth → POST /auth/login` (defaults log in as the system admin against tenant `system`)
2. `Auth → GET /auth/me` (should return `{ sub, tenantId: 'system', role: 'admin' }`)

## Access scope (who calls what)

The HTTP surface is a multi-tenant **control plane**, not split into "admin API" vs "tenant API" by data. Routes are gated by guard:

- **System admin** (token with `tenantId === 'system'`): everything under `/admin/*` (tenant onboarding, integration, competitor-origins, pipeline, DLQ).
- **Any authenticated user** (incl. a **tenant** admin/user — log in with your own `tenantSlug`): `/auth/*` and `/products/*` (the shared catalog is global, not tenant-scoped).
- **Public**: `/health`.

There are currently **no tenant-scoped data endpoints** (per-tenant product lists, offer books, pricing, etc.) — those are the routes marked ❌ "not yet ported" in [`CONTROLLER_MAPPING.md`](../CONTROLLER_MAPPING.md). The collection covers every route the app actually exposes.

## Coverage

Currently covers:

- `GET /health` (Plan 00 / 07)
- Auth (Plan 02): `POST /auth/login` (system + tenant-admin examples), `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- Admin tenants (Plan 06): `POST /admin/tenants`, `GET /admin/tenants`, `GET /admin/tenants/:slug`, `PATCH /admin/tenants/:slug/status`, `DELETE /admin/tenants/:slug`
- Admin integration (Plan 06): `PUT /admin/tenants/:slug/integration`, `POST /admin/tenants/:slug/integration/test`, `DELETE /admin/tenants/:slug/integration` — each tenant's `origin` selects the ERP vendor independently (v1: `a7pharma`)
- Admin competitor origins (Plan 06): `PUT /admin/tenants/:slug/competitor-origins` — all five origins (`DROGAL`, `DROGASIL`, `MICHELASSI`, `PAGUE_MENOS`, `IKESAKI`)
- Admin pipeline (Plan 06): `POST /admin/tenants/:slug/pipeline/start`, `GET /admin/tenants/:slug/pipeline/steps`, `POST /admin/tenants/:slug/pipeline/steps/:step`
- Admin DLQ (Plan 06): `GET /admin/dlq` (list queues), `GET /admin/dlq/:queue`, `POST /admin/dlq/:queue/replay`
- **Trigger competitors (each)** — no per-origin route; to run one competitor, `Enable only <ORIGIN>` (competitor-origins PUT) then `Run import-competitor-products` (standalone step trigger). The folder bundles the 5 enable requests + the step run.
- Products: `POST /products/:ean/import` (live-scrape every origin for one EAN → shared_catalog + merged view), `GET /products/export` (paginated export: product + primary image + latest stock)
- **Tenant — Pricing (apply & schedule)** — bulk price changes and scheduling. `POST /pricing/apply` (+ `preview`, `:id/approve`, `:id/reject`, `:id/rollback`, list, report) applies `precoVenda` (change price) and/or `precoOferta` (change offer price) in massa; `POST /pricing/schedules` (+ list, get, cancel) agenda o mesmo apply em `runAt`, one-shot ou recorrente (`cronExpr`), disparado pelo `PricingScheduleCron`

Pending plans that will add requests:

- **Plan 07** — extended health/observability endpoints (readiness, metrics) if applicable
