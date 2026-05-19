# 01 — Database Schema

**Date:** 2026-05-12
**Status:** Draft

## 1. Purpose

Define the database layout for the new app:

- **One Neon database** containing many **Postgres schemas**: `app_meta`, `shared_catalog`, and one `tenant_<slug>` per tenant.
- Replicate the existing prototype schema, **minus** `base_product` and `import_process`.
- A new, **simplified `base_product`** in the shared catalog with only the fields we actually need.
- A new `integration_database_connection` table in `app_meta`.

See `00-architecture.md` for the surrounding context and the rationale for choosing schema-per-tenant over DB-per-tenant.

## 2. Schemas

All schemas live in a single Neon database (`app-prod`).

| Schema | Purpose | Lifetime |
|---|---|---|
| `app_meta` | Tenant registry, integration-DB credentials, users, queue-job audit | Single, shared across all tenants |
| `shared_catalog` | Cross-tenant catalog: simplified `base_product`, scraped **competitor products & stock & images** (the canonical price/stock data for every competitor origin) | Single, shared |
| `tenant_<slug>` | Per-tenant data: **competitor selection config**, pricing rules, schedules, execution reports, status settings, tenant-specific product overrides | One per tenant |

### Tenant isolation: `search_path`

Every request and queue consumer wraps its work in a session that sets:

```sql
SET LOCAL search_path = tenant_<slug>, shared_catalog, public;
```

Unqualified table references then resolve through the path. Cross-schema joins are bare SQL:

```sql
SELECT bp.ean, pr.price
FROM shared_catalog.base_product bp
JOIN pricing_rule pr ON pr.ean = bp.ean;  -- pricing_rule resolves to tenant_<slug>.pricing_rule
```

A single NestJS middleware/interceptor is responsible for issuing the `SET LOCAL` — see `03-auth-and-tenancy.md`.

### Why one DB, many schemas

- Trivial cross-data joins between shared catalog and tenant data (the main reason we moved away from DB-per-tenant).
- One connection pool, one PgBouncer endpoint, one credential set.
- Storage and compute on Neon collapse to one database.
- Logical isolation is enforced at the schema level by `search_path`. We give up *physical* isolation; if compliance later demands it, a `pg_dump` of a tenant's schema can promote them to their own Neon DB without code changes beyond connection routing.

## 3. `app_meta` (new)

Tables in this schema:

| Table | Purpose |
|---|---|
| `tenant` | Tenant registry. Columns: `id`, `slug`, `schema_name` (`tenant_<slug>`), `name`, `status` (`active`/`paused`/`suspended`), `created_at`. |
| `integration_database_connection` | One row per tenant linking it to its ERP database. See `04-integration-data-source.md` for full schema. |
| `user` | App users for JWT auth. See `03-auth-and-tenancy.md`. |
| `pipeline_run` | Audit log of queue-driven pipeline runs: `id`, `tenant_id`, `step`, `status`, `started_at`, `finished_at`, `error`. Replaces the `import_process` lock model with an audit trail. |
| `tenant_schema_version` | Tracks migration version per tenant schema so the post-deploy migrator (see `02-queue-and-routines.md`) knows what to apply. |

## 4. `shared_catalog`

This DB holds everything that is the same across tenants. Schema is mostly **lifted from the prototype**, dropping `base_product` and `import_process` and rebuilding `base_product` in a simplified form.

### Tables retained from `farmacore/src/database/entities`

Copy as-is (column names, indexes, FKs unchanged):

- `product` (scraped competitor product — **shared across all tenants**; the same Drogal/Drogasil/Pague Menos/Ikesaki/Michelassi product row is read by every tenant that has the corresponding origin enabled)
- `product_image`
- `product_stock`

**Why competitor data is shared:** the scrape is expensive (hours of crawling) and the data is identical regardless of who's reading it. Doing the work once per origin and letting every interested tenant read the result is the whole point of sharing. Tenant isolation happens at the **read** layer via the `tenant_competitor_origin` table (see §6).

### Tables removed

- `base_product` — **rebuilt as a simplified entity, see §5**.
- `import_process` — **removed entirely**. Replaced by RMQ queues + `pipeline_run` audit log in `app_meta`. See `02-queue-and-routines.md`.
- `base_product_image` — removed (image generation tied to the old fat `base_product`; revisit if still needed).
- `base_product_stock` — kept only if still consumed downstream; otherwise drop. **Decision: drop for v1**, re-add when a real consumer appears.

### Tables moved to per-tenant schema

These are tenant-scoped in the new model and **do not live in `shared_catalog`**:

- `active_ingredient` — each tenant maintains their own list (different curated names, different MAT values, etc.)
- `classification` — each tenant maintains their own taxonomy (different category trees, different visibility rules)
- `offer_book_info` — offer-book metadata is a tenant-side concern, not a shared catalog one
- `offer_book` (it's owned by `base_product` today, but pricing decisions are tenant-specific — moved alongside the rules)
- `offer_book_pricing_rules`
- `offer_book_price_locks`
- `offer_book_rules`
- `offer_book_rules_products`
- `offer_book_rules_execution_report`
- `offer_book_rules_execution_report_item`
- `price_rounding_rule`
- `price_rounding_decimal_range`
- `scheduling`
- `status_settings`

## 5. Simplified `base_product` (in `shared_catalog`)

Only the fields you specified:

```ts
@Entity('base_product')
@Index('IDX_BASE_PRODUCT_EAN', ['ean'], { unique: true })
export class BaseProductTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', unique: true, nullable: false })
  public ean: number;

  @Column({ type: 'text', nullable: true })
  public description?: string;

  @Column({ type: 'text', nullable: true, name: 'active_ingredient' })
  public activeIngredient?: string;

  @Column({ type: 'boolean', default: false, nullable: false })
  public generic: boolean;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public height?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public length?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public width?: number;

  @NumericColumn({ precision: 10, scale: 3, nullable: true })
  public weight?: number;
}
```

### Notes on the simplification

- **EAN is the natural key**, kept `bigint` + unique.
- All ERP-only fields (`external_id`, `monitored`, `book`, `curve`, `cost`, `price`, `unit_sale_price`, `average_unit_cost`, `supplier`, `classification_id`, `mat`, `margin`, `average_variation`, `status`, `name`, `deals`, `origin`, `receipt_date`, `skip_image_generation`, `images`, `stocks`, `offer_books`, `activeIngredientEntity`, `cubic_weight`) are **removed** from the simplified entity. If any of these are still needed by a consumer, they belong elsewhere (per-tenant schema or scraped `product` table).
- `description` and `active_ingredient` are kept on the shared `base_product` because they are intrinsic to the product (EAN-keyed) and useful across tenants. Tenants that maintain their own curated `active_ingredient` table (see §4) can still join by name when they need MAT or extra metadata.
- Active ingredient is stored as a **plain text column** — no FK across schemas. The per-tenant `active_ingredient` table joins on the text value when needed.
- `BaseTypeormModel` (timestamps + soft-delete columns) is retained for consistency with the rest of the schema.

## 6. Per-tenant schema (`tenant_<slug>`)

Each tenant schema is created on tenant onboarding (see `03-auth-and-tenancy.md`) via `CREATE SCHEMA tenant_<slug>;` and contains:

- All tables listed in §4 under "moved to per-tenant schema".
- A **`tenant_competitor_origin`** config table (see below).
- A `tenant_product_override` table (renamed from the prototype's `product` to make scope explicit): **tenant-specific overrides only** — pricing decisions, custom notes, monitor flags, etc. Keyed by `(ean, origin)` so it references shared catalog rows without an enforced cross-schema FK (Postgres doesn't allow FKs across schemas to be the cleanest fit for our model; we enforce referential integrity in app code).

Per-tenant schemas do **not** hold their own copy of `base_product` or competitor `product` data — those live in `shared_catalog` and are joined directly via SQL.

### `tenant_competitor_origin` (per-tenant config)

This is how a tenant opts into the competitor origins they want to consume.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `origin` | `enum('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI', ...)` | Same enum as `shared_catalog.product.origin` |
| `enabled` | `boolean` | Default `true` — soft-toggle without deleting the row |
| `priority` | `int` | For UI ordering / pricing-rule tie-breakers |
| `config` | `jsonb` | Origin-specific config (e.g. price-list ID, region filter) — optional |
| `created_at`, `updated_at` | `timestamptz` | |

Unique on `(origin)` — one row per origin per tenant.

**How it's used:**

- A tenant's product queries against `shared_catalog.product` are always filtered by `origin IN (SELECT origin FROM tenant_competitor_origin WHERE enabled = true)`.
- The repository layer (a `SharedCatalogRepository` aware of `TenantContext`) applies this filter automatically — controllers don't need to remember.
- Onboarding a tenant inserts a default row per origin with `enabled=false`; admins enable the ones they want via an admin endpoint.

### Example

A new tenant signs up and wants to see DROGAL and DROGASIL:

```sql
UPDATE tenant_competitor_origin SET enabled = true
WHERE origin IN ('DROGAL', 'DROGASIL');
```

From that point on, every query the tenant makes against the shared catalog only returns those two origins' rows.

## 7. Migrations

- Each schema owns its own migration set:
  - `migrations/app_meta/` — applied against schema `app_meta`.
  - `migrations/shared_catalog/` — applied against schema `shared_catalog`.
  - `migrations/tenant/` — applied **per tenant schema** (templated; the runner substitutes `tenant_<slug>` for the placeholder).
- Initial migrations:
  1. **`app_meta`** — create `tenant`, `integration_database_connection`, `user`, `pipeline_run`, `tenant_schema_version`.
  2. **`shared_catalog`** — port the retained entities from `farmacore`; create the simplified `base_product`.
  3. **`tenant`** — port the moved tables; no `base_product`, no `import_process`.
- Migration *runner* for tenant schemas is described in `02-queue-and-routines.md` (the post-deploy migrator job). It iterates `app_meta.tenant` and applies pending tenant migrations to each `tenant_<slug>` schema.

## 8. Indexes & Performance Notes

- `base_product.ean` — unique.
- `tenant_product.ean` — index, not unique (one tenant may track the same EAN across multiple origins).
- `shared_catalog.product (ean, origin)` — composite index, ported from prototype.
- `pipeline_run (tenant_id, step, started_at)` — index for dashboards / debugging.
- `integration_database_connection (tenant_id)` — unique (one ERP source per tenant for v1).

## 9. Open Questions

- Does any future routine need to read `base_product` history? If yes, add a soft-delete + audit column set; if not, keep it lean.
- Should `tenant_product` link back to `base_product.id` (via shared catalog) or only by EAN? **Default for v1: by EAN** — avoids cross-DB FKs, which Postgres doesn't enforce anyway.
- Do we keep `BaseTypeormModel` exactly as in the prototype, or strip it down? **Default: keep, but audit which columns it actually adds.**

## 10. Success Criteria

- One Neon database provisioned with three schemas: `app_meta`, `shared_catalog`, and at least one `tenant_<slug>`.
- All retained entities from `farmacore` compile and migrate cleanly into their new home.
- Simplified `base_product` is the only `base_product` in the system; old fat entity is gone.
- `import_process` does not exist anywhere in the codebase.
- A query that joins `shared_catalog.base_product` with a tenant table returns correct, tenant-scoped data.
