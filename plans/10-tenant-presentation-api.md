# Plan 10 — Tenant Presentation API (port legacy read/management endpoints)

Status: **proposed**. Depends on: 01 (schema), 02 (auth/tenancy), 05 (pipeline produces the data), 09 (presentation). Legacy reference: `legacy-app/src/controllers/`, `legacy-app/src/use-cases/`.

## 1. Goal & the architectural shift

Legacy was **single-tenant**: the one customer's catalog lived in `base_product`, crossed against competitor `product` rows for prices/margins. Now:

| Legacy (single tenant) | New (multi-tenant) |
|---|---|
| `base_product` = the customer's catalog | **`tenant_<slug>.product`** — one copy per tenant (this *is* the tenant's catalog) |
| `product` (competitor, ean+origin) | **`shared_catalog.product`** — shared across tenants |
| — | **`shared_catalog.base_product`** — only immutable, ean-distinct identity (dimensions, active ingredient); NOT the tenant's catalog |
| `offer_book` (FK base_product) | `tenant_<slug>.offer_book` (keyed by ean, `target_price`) |
| `classification`, `status_settings` | `tenant_<slug>.classification`, `core.status_settings` (per tenant) |

> **Naming:** there is **no "base" concept at the tenant level**. A tenant's products are just **products**. `shared_catalog.base_product` is internal ean-identity storage, never exposed as a route. So tenant catalog routes are `/products/*` — **not** `/products/base/*`.

Every ported read is a **per-tenant cross**: `tenant.product` (resolves via the request `search_path`) `LEFT JOIN shared_catalog.product` (competitor prices by ean+origin) `LEFT JOIN tenant.offer_book` — the exact pattern in `src/pipeline/steps/calc-base-product-metrics.step.ts`. `margin`/`average_variation`/`status` are already computed & stored on `tenant.product` by the pipeline; reads project them and re-cross only for the live competitor price/observation columns.

## 2. Access model & namespace (clean admin ↔ tenant split)

**Rule of thumb (so the FE / an AI agent can read the surface unambiguously):**

- **`/admin/*`** → system-admin only (`SystemAdminGuard`, `tenantId==='system'`). Tenant lifecycle, integration, competitor-origin toggles, pipeline triggers, DLQ, and **shared-catalog ops** (single-EAN live import, shared-catalog export).
- **everything else** → **tenant operations**: authenticated tenant user, auto-scoped to their schema by `SearchPathInterceptor`. No special guard; role-gated via `@Roles`:
  - reads → any tenant user (omit `@Roles` ⇒ viewer/operator/admin).
  - mutations (price/offer/product edits) → `@Roles(OPERATOR, ADMIN)`.
  - tenant config (status-settings, price-rounding) → `@Roles(ADMIN)`.

**Move (Phase 0):** the two existing global product endpoints are admin/ops on the shared catalog, so relocate them under `/admin` to keep `/products/*` purely tenant:
- `POST /products/:ean/import` → **`POST /admin/catalog/products/:ean/import`**
- `GET /products/export` → **`GET /admin/catalog/products/export`**

**New shared building block:** `@TenantEm()` param decorator returning `req.entityManager` (set by `SearchPathInterceptor`) so tenant handlers/services get the tenant-scoped `EntityManager` directly.

## 3. Schema gaps & decisions (locked)

- **`curve`/`book`/`mat`** on `tenant.product` — **deferred** (tracked in `TODO.md`). v1 tenant catalog omits those filters/sorts/columns. (TODO records exactly where to add them if revisited.)
- **Per-ingredient `mat`**, **customer product images** — deferred (TODO).
- **ERP write-back (Phase 4): writes are HTTP, not DB.** Confirmed against `legacy-app/src/services/a7-pharma-api.service.ts`: prices/offers are written via A7Pharma's REST API (`POST /webapi/api/preco/`, `POST`/`DELETE /webapi/api/oferta/`) using a `baseUrl` + `apiKey`. The new per-tenant integration only stores **DB** creds (read-only). So write-back requires **storing per-tenant A7Pharma API credentials** (baseUrl + apiKey) — see Phase 4.
- **Offer-book rule engine** → separate **Plan 11** (net-new tables, large).
- **`core.price_rounding_rule`/`scheduling`** exist but dormant; CRUD is cheap, *applying* rounding/scheduling is engine/cron work (Plan 11 / deferred).

## 4. Structure

```
src/tenant-api/                          # tenant-user-facing (no admin guard; tenant-scoped)
  tenant-api.module.ts                   # registered in app.module.ts
  catalog/
    catalog.controller.ts                # /products, /products/crossed, /strategic-price, /stock(+metrics),
                                         #   /active-ingredients(+/crossed, /generic-missing), /export
                                         #   mutations: PATCH /products/:ean, POST /products/:ean/price|offer, DELETE ...
    catalog.service.ts                   # the cross queries (parameterised SQL like calc step)
    dto/                                 # query DTOs (page/perPage/sortBy/sortDirection + filters) + response DTOs
  offer-books/offer-books.controller.ts  # GET /offer-books/info
  classifications/classifications.controller.ts  # GET /classifications(/grouped)
  settings/status-settings.controller.ts # GET/PATCH /settings/variation-status (ADMIN write)
  configurations/price-rounding.controller.ts    # CRUD core.price_rounding_rule (ADMIN)
src/tenant/decorators/tenant-em.decorator.ts     # @TenantEm()
```
Move existing `src/products/*` → `src/admin/controllers/catalog.controller.ts` (the shared-catalog admin ops) under `AdminModule`; delete the global `/products` controller.

- Reads in `*.service.ts` take `@TenantEm()` `EntityManager`, run the cross, map to response DTOs. Standard pagination + `{ rows, count }`.
- DTOs via `class-validator` (global `ValidationPipe`).

## 5. Phases (each shippable; reads first)

### Phase 0 — Foundations + admin/tenant split
- `@TenantEm()` decorator; `TenantApiModule` in `app.module`.
- **Relocate** the two shared-catalog endpoints to `/admin/catalog/...` (above); update Postman so the collection has exactly two top-level areas: **Admin** and **Tenant**.
- E2E harness: tenant with seeded `tenant.product` + `shared_catalog.product`; login as `viewer`/`operator`/`admin`.

### Phase 1 — Tenant catalog reads (headline)
| Legacy | New (tenant) | Role | Data / cross |
|---|---|---|---|
| `GET /products/base` | `GET /products` | any | `tenant.product` (+classification), filters: name/eans/classification/active/generic |
| `GET /products/base/crossed` | `GET /products/crossed` | any | **cross**: `tenant.product` ⨝ `shared_catalog.product` (DROGAL/DROGASIL/MICHELASSI `price`, `metadata->>'observation'`/`isPbm`/`van`) ⨝ `tenant.offer_book.target_price`; projects stored margin/avg_variation/status. Filters: eans/name/supplier/classification/status/book?/receiptDate. |
| `GET /products/base/strategic-price` | `GET /products/strategic-price` | any | crossed + `WHERE` competitor observation present OR `tenant.product.deals` present; surfaces deals + competitor "deal" text. |
| `GET /products/export` (legacy) | `GET /products/export` (tenant) | any | crossed → CSV (port `export-products.use-case.ts`; selectable columns). |

### Phase 2 — Stock
`GET /products/stock`, `GET /products/stock-metrics` (any): customer stock = `tenant.product_stock` × `core.tenant_subsidiary`; competitor = latest `shared_catalog.product_stock`; re-express the ANALYZE_INCLUSION/POTENTIAL/OK rule over the new shape.

### Phase 3 — Active ingredients
`GET /products/active-ingredients` (distinct), `GET /products/active-ingredients/crossed` (group by `active_ingredient`, variants + competitor prices + target=min), `GET /products/generic-missing-active-ingredients`, `PATCH /products/:ean/active-ingredient` (OPERATOR+).

### Phase 4 — Mutations + ERP write-back (HTTP)
Prereq: **per-tenant A7Pharma API creds**. Add `api_base_url` + `api_key_encrypted` to `core.integration_database_connection` (or a sibling `core.integration_api_connection`), settable via the admin integration endpoint; build an `A7PharmaApiClient` (HTTP, port `a7-pharma-api.service.ts`) resolved per tenant.
| `PATCH /products/:ean` | OPERATOR+ | merge editable fields on `tenant.product`. |
| `POST /products/:ean/price` | OPERATOR+ | guard `monitored`/`external_id`; set price; **POST A7Pharma `/webapi/api/preco/`**. |
| `POST /products/:ean/offer` | OPERATOR+ | upsert `tenant.offer_book`; **POST A7Pharma `/webapi/api/oferta/`**. |
| `DELETE /products/:ean/offer` | OPERATOR+ | clear offer; **DELETE A7Pharma oferta**. |
| `DELETE /products/:ean` | ADMIN | soft delete (`active=false`). |

### Phase 5 — Tenant config ✅
`GET/PATCH /settings/variation-status` (read any / write ADMIN; `core.status_settings`); `GET /classifications(/grouped)` (any; `tenant.classification` tree); `/configurations/price-rounding` CRUD (ADMIN; `core.price_rounding_rule` + decimal ranges). Status-settings/price-rounding live in `core` keyed by tenant uuid — resolved from the JWT slug via `src/tenant/tenant-lookup.ts`.

> **Phase-4 tail, not built:** `POST`/`DELETE /products/:ean/offer` write-back is blocked on a design decision — A7Pharma's `/webapi/api/oferta/` needs `idCadernoOferta`, which the new model stores nowhere (`tenant.offer_book` is ean/description/target_price only). Needs either a per-tenant caderno id in config or an `external_id` on `offer_book`. `GET /offer-books/info` also pending (response shape undefined).

### Phase 6 — Offer-book rule engine → **Plan 11** (deferred).
### Phase 7 — Scheduling → deferred (needs executor).

## 6. Postman / FE-friendliness
Restructure the collection into two clear top-level areas — **Admin** (system) and **Tenant** (the FE's surface) — each folder = a controller, every request with body/query examples + description. Keep tenant routes flat and predictable (`/products`, `/products/crossed`, …) so an AI agent can generate the frontend straight from the collection. Update `CONTROLLER_MAPPING.md` (flip ❌→✅) as each phase lands.

## 7. Testing
Unit: `CatalogService` cross over a seeded tenant schema (margin/variation/status + competitor columns). E2E per phase: viewer read ✓, viewer mutation 403, operator/admin mutation ✓, cross-tenant isolation (tenant A can't see tenant B — assert search_path enforces it).

## 8. Out of scope (v1)
curve/book/mat, per-ingredient mat, customer images, AI generate-* , CSV import, the rule engine (Plan 11), scheduling executor.
