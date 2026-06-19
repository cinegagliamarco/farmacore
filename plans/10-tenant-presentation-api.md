# Plan 10 — Tenant Presentation API (port legacy read/management endpoints)

Status: **proposed**. Depends on: 01 (schema), 02 (auth/tenancy), 05 (pipeline — produces the data), 09 (presentation layer). Legacy reference: `legacy-app/src/controllers/`, `legacy-app/src/use-cases/`.

## 1. Goal & the architectural shift

Legacy was **single-tenant**: the one customer's catalog lived in `base_product`, and every read endpoint crossed it against competitor `product` rows (by `ean + origin`) to show prices/margins/status. There were no tenants.

Now the data is **split**:

| Legacy (single tenant) | New (multi-tenant) |
|---|---|
| `base_product` (the customer's catalog) | `tenant_<slug>.product` — **one copy per tenant** |
| `product` (competitor, by ean+origin) | `shared_catalog.product` — **shared across all tenants** |
| `offer_book` (FK base_product) | `tenant_<slug>.offer_book` (keyed by ean, `target_price`) |
| `classification` | `tenant_<slug>.classification` (tree: name + parent_id) |
| `status_settings` | `core.status_settings` (per tenant) |
| `active_ingredient` table (+ `mat`) | ❌ not modelled — only `tenant.product.active_ingredient` (text) + `generic` |

**So every ported read becomes a per-tenant cross**: read `tenant.product` (resolves via the request's `search_path`) `LEFT JOIN shared_catalog.product` on `ean`+origin, `LEFT JOIN tenant.offer_book` on ean — exactly the pattern already in `src/pipeline/steps/calc-base-product-metrics.step.ts`. The metrics (`margin`, `average_variation`, `status`) are **already computed and stored** on `tenant.product` by the pipeline; read endpoints mostly project them, only re-crossing for the live competitor *prices/observations* columns the UI shows.

Triggers/imports stay **admin-only** (existing `/admin/...` + `SystemAdminGuard`). This plan adds the **tenant-user-facing** surface.

## 2. Access model

- Tenant users already exist (`core."user"`, `tenant_id` = slug, `role ∈ {admin, operator, viewer}`); onboarding mints an initial `admin`. They log in via `POST /auth/login` with their own `tenantSlug`.
- The global `JwtAuthGuard` + `RolesGuard` + `SearchPathInterceptor` already scope every authenticated request to the JWT's tenant schema and attach `req.entityManager`. **Tenant controllers need no special guard** — being authenticated already scopes you.
- Role gating per route via `@Roles(...)`:
  - **reads** → `@Roles(VIEWER, OPERATOR, ADMIN)` (i.e. any authenticated tenant user; omit `@Roles` to allow all).
  - **mutations** (price, offers, product edits) → `@Roles(OPERATOR, ADMIN)`.
  - **tenant config** (status-settings, price-rounding) → `@Roles(ADMIN)`.
- `system` admins (`tenantId==='system'`) are not the audience here; they use `/admin/*`. (A system admin's JWT would scope to the `system` schema, which has no `product` — fine, they don't call these.)

**New shared building block (Phase 0):** a `@TenantEm()` param decorator returning `req.entityManager` (set by `SearchPathInterceptor`), so handlers/services get the tenant-scoped `EntityManager` without re-deriving it. Plus a `TenantModule`-exported helper if a service needs it outside a request.

## 3. Schema gaps (decide before porting the affected endpoints)

The legacy UI used columns/tables that **don't exist** in the new schema. Each needs a decision (migration vs drop vs defer):

| Gap | Legacy use | Decision options |
|---|---|---|
| `tenant.product` has **no `curve`, `book`, `mat`** | filters/sorts on get-base-products & crossed | **(A)** add columns to `tenant.product` (+ populate from ERP sync in plan 05) — needed for parity; **(B)** drop those filters for v1. → *Recommend A; small migration + sync mapping.* |
| No tenant **active_ingredient** table with `mat` | `/active-ingredients`, `/active-ingredients/crossed` grouping + target price | group by `tenant.product.active_ingredient` (text) for v1; `mat` per-ingredient deferred (no source). |
| No **customer product images** (`base_product_image`) | images in get-base-products | shared_catalog has *competitor* images only. Defer customer images, or add `tenant.product_image`. |
| Competitor **stock shape differs** | legacy `product_stock.subsidiary_one/two_stock`; UI shows per-subsidiary | new `shared_catalog.product_stock` = `(product_id, quantity, captured_at)` snapshots (latest = current). Customer stock = `tenant.product_stock (ean, subsidiary_external_id, quantity)` + `core.tenant_subsidiary` labels. Stock endpoints map to these; the "ANALYZE_INCLUSION/POTENTIAL/OK" rule re-expressed over the new shape. |
| No **offer_book_rules** engine tables | the whole `/offer-book-rules` rule engine | **net-new** (large). Its own phase; needs `core` or tenant tables for rules/pricing-rules/price-locks/execution-reports. |
| `core.scheduling` exists but **dormant** (no executor) | `/scheduling` deferred actions | wire an executor (cron) if porting; else expose read-only. |
| `core.price_rounding_rule` exists but **dormant** | `/configurations/price-rounding` + applying rounding in rule execution | CRUD is easy (tables exist in core); *applying* rounding belongs to the rule engine phase. |

> Phases below assume **decision A** for curve/book/mat (add columns). If deferred, mark those filters “v2”.

## 4. Module / file structure

```
src/tenant-api/                         # all tenant-user-facing controllers
  tenant-api.module.ts                  # imports nothing tenant-specific beyond TenantModule; registered in app.module
  decorators/tenant-em.decorator.ts     # @TenantEm() -> req.entityManager  (move to src/tenant/ if reused)
  catalog/
    catalog.controller.ts               # /products/base*  (reads + mutations)
    catalog.service.ts                  # cross queries (tenant.product ⨝ shared_catalog.product ⨝ offer_book)
    dto/                                 # list/crossed/strategic/stock query DTOs + response DTOs
  offer-books/offer-books.controller.ts # /offer-books/info (read)
  classifications/classifications.controller.ts
  settings/status-settings.controller.ts        # /settings/variation-status (read+update, ADMIN)
  configurations/price-rounding.controller.ts   # CRUD over core.price_rounding_rule
  offer-book-rules/...                  # later phase (rule engine)
```

- Reads/queries live in `*.service.ts`, taking the tenant `EntityManager` (from `@TenantEm()`), running the cross SQL (parameterised) and mapping to response DTOs. Pattern mirrors `calc-base-product-metrics.step.ts`.
- DTOs use `class-validator` (global `ValidationPipe` already on). Standard pagination: `page`, `perPage`, `sortBy`, `sortDirection`; standard response `{ rows, count }`.
- Routes keep **legacy paths** (`/products/base/crossed`, `/offer-books/info`, `/classifications`, …) so the existing frontend ports with minimal change — tenant is inferred from the JWT, not the URL.
  - ⚠️ **Collision:** the global `GET /products/export` (shared-catalog export, built earlier) differs from legacy `/products/export` (customer catalog CSV). Put the tenant catalog export at **`GET /products/base/export`**; leave the shared one as-is.

## 5. Phased rollout

Each phase is independently shippable (PR + tests). Reads first (highest value, lowest risk), then mutations, then config, then the rule engine.

### Phase 0 — Foundations
- `@TenantEm()` decorator; `tenant-api.module.ts` registered in `app.module.ts`.
- `CatalogService` skeleton + a shared paginate helper.
- (If decision A) migration: add `curve text`, `book text`, `mat numeric` to `tenant.product`; map them in the `sync-base-product` step (plan 05) from the ERP embalagem/curve fields.
- E2E harness: seed a tenant + a few `tenant.product` rows + `shared_catalog.product` rows, log in as a tenant `viewer`/`admin`.

### Phase 1 — Core catalog reads (the headline feature)
| Legacy | New (tenant-scoped) | Role | Data / cross |
|---|---|---|---|
| `GET /products/base` | `GET /products/base` | any | `tenant.product` (+ `classification` join), filters: name/eans/classification/active/generic (+curve/origin if A) |
| `GET /products/base/crossed` | `GET /products/base/crossed` | any | **the cross**: `tenant.product` ⨝ `shared_catalog.product` (DROGAL/DROGASIL/MICHELASSI prices, observation, isPbm/van from metadata) ⨝ `tenant.offer_book` (target_price). Project stored `margin`/`average_variation`/`status`. Filters: eans/name/supplier/classification/status/book/receiptDate. |
| `GET /products/base/strategic-price` | same | any | crossed + `WHERE` competitor `metadata->>'observation'` present OR `tenant.product.deals` present; surfaces `deals` + competitor "deal" observations. |
| `GET /products/base/export` | `GET /products/base/export` | any | crossed flattened to CSV (port `export-products.use-case.ts`; columns selectable). |

Note: legacy crossed read drogal_is_pbm/van/observation from `product` columns; in the new schema those live in `shared_catalog.product.metadata` jsonb (`isPbm`, `van`, `observation`) — select via `metadata->>'...'`.

### Phase 2 — Stock reads
| Legacy | New | Role | Notes |
|---|---|---|---|
| `GET /products/base/stock` | `GET /products/base/stock` | any | customer stock from `tenant.product_stock` (×`core.tenant_subsidiary` labels) + competitor latest `shared_catalog.product_stock`; recompute the ANALYZE_INCLUSION/POTENTIAL/OK rule over the new shape. |
| `GET /products/base/stock-metrics` | same | any | aggregates of the above (percentages per subsidiary/origin). |

### Phase 3 — Active ingredients
| `GET /products/base/active-ingredients` | same | any | distinct `tenant.product.active_ingredient`. |
| `GET /products/base/active-ingredients/crossed` | same | any | group tenant products by `active_ingredient`, variants with competitor prices + target price (min). `mat` per-ingredient deferred. |
| `GET /products/base/generic-missing-active-ingredients` | same | any | `WHERE generic AND active_ingredient IS NULL`. |
| `PATCH /products/base/generic-missing-active-ingredients/:id` | same (`:ean`) | OPERATOR+ | set `active_ingredient`. Key by `ean` (new PK is uuid; legacy used int id — expose by ean). |

### Phase 4 — Catalog mutations (write back to ERP)
| Legacy | New | Role | Notes |
|---|---|---|---|
| `PATCH /products/base/:id` | `PATCH /products/base/:ean` | OPERATOR+ | shallow-merge editable fields on `tenant.product`. |
| `POST /products/base/price/:id` | `POST /products/base/:ean/price` | OPERATOR+ | guard `monitored`/`external_id`; update `tenant.product.price`; **push to A7Pharma** via the integration DataSource (write path — needs an ERP write client; legacy used `a7PharmaApiService.changePrices`). |
| `POST /products/base/offers/:id` | `POST /products/base/:ean/offer` | OPERATOR+ | upsert `tenant.offer_book.target_price`; push offer to ERP. |
| `DELETE /products/base/offers/:id` | `DELETE /products/base/:ean/offer` | OPERATOR+ | clear offer; push null to ERP. |
| `DELETE /products/base/:id` | `DELETE /products/base/:ean` | ADMIN | soft delete (`active=false`). |

> ⚠️ Price/offer writes hit the **tenant's ERP** (A7Pharma) — the integration is currently **read-only** (`read_only: true`). Porting writes requires an ERP write client + relaxing read-only per tenant. Scope as a sub-decision; reads (Phases 1–3) don't need it.

### Phase 5 — Tenant config reads/writes
| `GET/PATCH /settings/variation-status` | same | read any / write ADMIN | `core.status_settings` by tenant_id (already consumed by the metrics step). |
| `GET /classifications`, `/classifications/grouped` | same | any | `tenant.classification` tree (flat list / grouped by parent). |
| `/configurations/price-rounding` CRUD | same | ADMIN | over `core.price_rounding_rule` + `core.price_rounding_decimal_range` (tables exist; keyed by tenant_id). |

### Phase 6 — Offer-book rule engine (net-new, large)
Port `offer-book-rules.controller.ts` + its 12 use-cases (create/update/delete/list, preview, preview-download, execute, execution-reports). Requires net-new tenant tables: `offer_book_rule`, `offer_book_rule_product`, `offer_book_pricing_rule`, `offer_book_price_lock`, `offer_book_rule_execution_report(_item)`. Execution is async (a pipeline step or a dedicated job) computing offer prices from competitor data + pricing rules + rounding, writing offers back to ERP. **Own plan (11) recommended** — too big for this one.

### Phase 7 — Scheduling (optional)
`/scheduling` CRUD over `core.scheduling` + a cron executor that applies deferred actions (price changes, etc.). Defer unless needed.

## 6. Per-endpoint cross reference (legacy → this plan)

Update `CONTROLLER_MAPPING.md` as each phase lands: flip the ❌ rows for `base-product.controller.ts`, `offer-book.controller.ts`, `classification.controller.ts`, `configurations.controller.ts`, `status-settings.controller.ts`, `offer-book-rules.controller.ts` to ✅ with the new tenant route.

## 7. Testing
- Unit: `CatalogService` cross query against a seeded tenant schema (the e2e DB), asserting margin/variation/status projection + competitor price columns.
- E2E: per phase — login as tenant `viewer` (reads succeed) and `viewer` attempting a mutation (403); `operator`/`admin` mutation succeeds; cross-tenant isolation (tenant A can't see tenant B's products — guaranteed by search_path, assert it).
- Keep the Postman collection in sync (new "Tenant — Catalog" folder; tenant-admin login already added).

## 8. Out of scope / explicit non-goals (v1)
- ERP write-back for price/offers (Phase 4) unless the read-only integration is relaxed.
- Per-ingredient `mat`, customer product images, AI description/image generation (`generate-*`), CSV import (`/import/csv`) — all ❌ deferred.
- The offer-book rule engine ships as **Plan 11**, not here.
