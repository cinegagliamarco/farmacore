# Postman collection

`farmacore.postman_collection.json` is the canonical Postman v2.1 collection for the Farmacore HTTP API. It is hand-curated and kept in sync with `plans/` — every plan that introduces, renames, or removes a controller route must update this file in the same commit.

## Sync rule

For each plan that touches `*.controller.ts`:

1. Add / update the request in the matching folder (`Health`, `Auth`, `Admin — …`, `Tenant — …`).
2. Set `auth` per route — public routes use `{ "type": "noauth" }`; protected routes inherit collection-level Bearer.
3. Reference the controller file in the request `description` (`Plan 02 — src/auth/auth.controller.ts`).
4. If the request returns a token (login, refresh), add a Tests script that stores it as a collection variable.

## Variables

| key                | default                     | purpose                                                        |
| ------------------ | --------------------------- | -------------------------------------------------------------- |
| `baseUrl`          | `http://localhost:3000`     | API base. Override for staging/prod.                            |
| `tenantSlug`       | `acme`                      | Default tenant slug used in `/admin/tenants/:slug/*` routes.    |
| `step`             | `sync-base-product`         | Pipeline step for `/admin/tenants/:slug/pipeline/steps/:step`.  |
| `accessToken`      | (set by login/refresh)      | JWT bearer; auto-populated by the login test.                   |
| `refreshToken`     | (set by login/refresh)      | Refresh token; auto-populated by the login test.                |
| `ean`              | `EXAMPLE_EAN`                | Replace with a product EAN for `/products/:ean*` and `/admin/catalog/*` routes.|
| `ean2`             | `EXAMPLE_EAN_2`              | Optional second product EAN in multi-product examples.           |
| `adminEmail`       | (set before sending)         | Email for the tenant-admin onboarding request.                   |
| `queue`            | `sync-base-product.batch`   | Queue name for `/admin/dlq/:queue*` routes.                     |
| `storeId`          | (paste from `GET /products/stores`) | Store **uuid** — goes in bodies (price writes, suggestion rules). |
| `storeExternalId`  | `3`                         | Store **ERP id** — goes in `?store=` query params of the grids. |
| `storeClusterId`   | (paste from a cluster)      | Used by `/store-clusters/:id` routes.                           |
| `ruleId`           | (paste from a rule)         | Used by `/configurations/price-rounding/:id` routes.            |
| `applyRunId`       | (paste from an apply run)   | Used by `/pricing/apply/:id*` routes.                           |
| `scheduleId`       | (paste from a schedule)     | Used by `/pricing/schedules/:id` routes.                        |
| `pricingClusterId` | (paste from a cluster)      | Used by `/pricing/clusters/:id` routes.                         |
| `suggestionRuleId` | (paste from a rule)         | Used by `/pricing/suggestion-rules/:id` routes.                 |
| `offerBookRuleId`  | (paste from a rule)         | Used by `/offer-book-rules/:id*` routes.                        |

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

- **System admin** (token with `tenantId === 'system'`): everything under `/admin/*` (tenant onboarding, integration, competitor-origins, pipeline, DLQ, shared-catalog ops).
- **Tenant users** (log in with your own `tenantSlug`): `/auth/*` plus the whole tenant surface — the **Tenant — …** folders (`/products`, `/stores`, `/settings`, `/configurations`, `/classifications`, `/pricing`, `/offer-book-rules`, …). The tenant scope comes from the JWT, never from the URL; role (`viewer`/`operator`/`admin`) and enabled modules gate each route.
- **Public**: `/health`, `/auth/login`, `/auth/refresh`.

Who can call what, per endpoint, lives in [`../docs/api-reference.md`](../docs/api-reference.md). The collection covers every route the app actually exposes.

## Coverage

The collection mirrors **all 90 endpoints** of the API, organized in 16 folders:

`Health` · `Auth` · `Admin — Tenants` · `Admin — Integration` · `Admin — Competitor origins` · `Admin — Pipeline` · `Admin — DLQ` · `Admin — Trigger competitors (each)` · `Admin — Catalog (shared catalog ops)` · `Tenant — Catalog` · `Tenant — Stores` · `Tenant — Config` · `Tenant — Integration` · `Tenant — Offer book rules` · `Tenant — Pricing (apply & schedule)` · `Tenant — Pricing (sugestões & regras)`

Per-endpoint documentation (auth, roles, modules, bodies, errors, recipes — including "scrape a single competitor"): [`../docs/api-reference.md`](../docs/api-reference.md). Guided run of the admin/pipeline core: [`WALKTHROUGH.md`](./WALKTHROUGH.md).
