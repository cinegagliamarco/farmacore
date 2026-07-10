# Plan: Stores, Clusters and Per-Store Pricing (2026-06-28)

> **Date:** 2026-06-28 · **Repo:** farmacore · **Base branch:** `refactor/remove-stock`
> **Principle:** stay as lean as possible. Reuse what already exists
> (`core.tenant_store`, the existing per-tenant A7Pharma connection + API
> key, the write-back client) instead of creating parallel concepts.
>
> ⚠️ **SUPERSEDED in part (2026-07-09):** every claim here that offers are
> global (§3, §9, `product_item.price_offer` as a global mirror) was reversed —
> offers ARE per-store via the caderno↔store participation table
> `unidadenegocioparticipantecadernooferta`, and `price_offer` now holds the
> store's real winning-caderno offer. See
> [`plano-regras-preco-por-loja-2026-07-09.md`](./plano-regras-preco-por-loja-2026-07-09.md).

## 1. Executive summary

- Introduces **stores** (stores / business units) as a first-class
  entity, **reusing** `core.tenant_store` (extended), synchronized from the
  A7Pharma `unidadenegocio` table (filter `status = 'A'`).
- Stores are deduped/matched by **CNPJ** (unique) but also store the A7
  **`external_id`** (`unidadenegocio.id`) — required for all per-store reads and
  writes.
- Introduces **`product_item`**: the per-store projection of `price`,
  `price_offer` and `cost`. Only synced for **active** stores.
- Introduces **store clusters** (`store_cluster`) to group stores.
- Price write-back stays on the **per-tenant API key**; the store is targeted by
  the **`idUnidadeNegocioPreco`** payload field (= store `external_id`).
- Exposes **tenant-admin** APIs to list stores, `PUT` `active`/cluster, and
  manage clusters.

## 2. Goals and non-goals

**Goals**

- Data model: extend `core.tenant_store`; add `store_cluster`,
  `product_item` (tenant) and the A7Pharma read entity `unidadenegocio`.
- Sync: import stores (match by CNPJ, `status = 'A'`); import per-store
  `price`/`cost` (+ global `price_offer`) **only for active** stores.
- Per-store price write-back via `idUnidadeNegocioPreco`.
- Tenant-admin management APIs (list, enable/disable, attach to a cluster).

**Non-goals**

- Per-store DB connections or per-store API keys — **not needed**: one
  connection + one API key per tenant; per-store data is keyed by
  `unidadenegocioid`, per-store writes by `idUnidadeNegocioPreco` (see §3).
- Rewriting the suggestion/pricing engine to be per-store (this plan only
  delivers the per-store data foundation).
- UI/frontend (separate plan).

## 3. Context (verified against the live `loja01` DB + A7 API doc)

- `core.tenant_store` already exists (`id`, `tenant_id`, `external_id`,
  `name`, `active`) and is already read (raw SQL) by `catalog.service.ts
  stores()`. We **reuse and extend** it. (That method JOINs
  `product_stock`, removed in this branch — a pre-existing breakage to clean up
  separately; out of scope.)
- **Authentication is one API key per tenant/base**, not per store. The A7 doc
  ([KB](https://kb.a7.net.br/index.php?title=Geral:API_ALTERAÇÃO_DE_PREÇO_E_CADERNO_DE_OFERTAS_-_Como_funciona%3F))
  uses a single `API-KEY` header for both the price and offer endpoints. So the
  existing per-tenant key in `integration_database_connection` stays as is — **no
  per-store token.**
- **Per-store price is targeted in the payload**, via `idUnidadeNegocioPreco`
  (the `unidadenegocio.id`) on `POST /webapi/api/preco/?alterarIrmas=false`.
  Offers (`/webapi/api/oferta/`) have **no** unidade param → offers are global.
- **A7Pharma per-store read sources (verified on live `loja01`):**
  - Sell price → `precoembalagemunidadenegocio(embalagemid, unidadenegocioid).precovenda`
    (per-store override; `embalagem.precovenda` is the global/base fallback).
  - Cost → `custoproduto(produtoid, unidadenegocioid).custo` (confirmed
    per-store: same product = R$3.87 for one unit, R$3.99 for another).
  - Offer price → **global** `itemcadernooferta.precooferta` (no `unidadenegocioid`).
- **One DB carries per-unit data for all stores** (and per the customer, the
  per-store connections are replicas of the same data). So a **single tenant
  connection** reads every store's price/cost by `unidadenegocioid`.
- **Name-collision warning:** `product_cluster` already groups EANs for pricing
  rules. This plan's cluster groups **stores** → table `store_cluster`.

## 4. Domain and glossary

| Term | Meaning in code |
|---|---|
| Store | Store / business unit. `core.tenant_store` (reused, extended). |
| CNPJ | Unique business id; the **dedup/match key** for store sync. |
| `external_id` | `unidadenegocio.id` (bigint). Needed for per-store reads (`precoembalagemunidadenegocio`, `custoproduto`) and writes (`idUnidadeNegocioPreco`). |
| `store_cluster` | Group of stores. In `core` (`id`, `name`, `tenant_id`). |
| `product_item` | Per-store projection of `price`/`price_offer`/`cost`. In the **tenant** schema; references the store by core uuid. |
| `unidadenegocio` | A7Pharma source table (read-only): `id`, `status`, `codigo`, `nome`, `cnpj`, `razaosocial`, … (no token). |
| `idUnidadeNegocioPreco` | Price-write payload field = store `external_id`. Targets one store. |

## 5. Solution architecture

### 5.1 Where each thing lives

- **`core`** (control-plane, by `tenant_id`): `tenant_store` (extended) and
  `store_cluster`.
- **tenant schema**: `product_item`, referencing the product by FK and the
  store by `store_id` (core uuid) — logical ref, resolved in code.
- **A7Pharma (read-only)**: new `UnidadeNegocioEntity` (`synchronize: false`) +
  the per-store price entity `PrecoEmbalagemUnidadeNegocioEntity`, registered in
  `A7PHARMA_ENTITIES`.

### 5.2 Database access (verified conventions)

- **No separate core connection.** One shared DataSource registers every entity;
  the tenant-scoped `em` reaches `core.*` because core entities declare
  `@Entity({ schema: 'core' })`. Pipeline steps and tenant-api write
  `core.tenant_store` through the same `em`.
- **Tenant-api reads core via raw SQL:** `resolveTenantId(em, slug)` then
  `em.query('… core.tenant_store … WHERE tenant_id = $1', [tenantId])`.
- **Pipeline steps** get `tenantId` from `ctx.tenant.id` / `ctx.message.tenantId`
  and the integration `DataSource`.
- **A7 entity registration:** add the new entities to `A7PHARMA_ENTITIES` in
  `src/integration/entities/a7pharma/index.ts`; the factory picks them up.

### 5.3 Price write-back flow (per-store, single key)

```
POST /products/:ean/price  { newPrice, storeId }
  └─ CatalogMutationService.updatePrice(em, tenantSlug, ean, newPrice, storeId)
       ├─ load product (externalId required, monitored blocks)
       ├─ load store (core.tenant_store by id) → external_id
       ├─ integration.getApiCredentials(tenantSlug)        ← per-tenant API key (unchanged)
       ├─ a7.changePrices(creds, [{ idEmbalagem, precoVendaNovo,
       │                            idUnidadeNegocioPreco: external_id }])   ← targets the store
       └─ local mirror: product_item.price for (product, storeId)
```

`A7PharmaApiClient.changePrices` gains an optional `idUnidadeNegocioPreco` per
item. `getApiCredentials` stays per-tenant — no per-store creds.

## 6. Data model

### 6.1 `core.tenant_store` (extend)

Resulting columns:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | existing |
| `tenant_id` | `uuid` | existing |
| `external_id` | `bigint` | existing · `unidadenegocio.id` · needed for per-store read/write |
| `name` | `text` | existing |
| `active` | `boolean` | existing; **new rows inserted as `false`** (opt-in) |
| `cnpj` | `text` | **new** · dedup/match key · unique per tenant |
| `cluster_id` | `uuid` nullable | **new** · FK → `core.store_cluster(id)` `ON DELETE SET NULL` |

- Keep `external_id`; add unique `(tenant_id, cnpj)` (the sync matches by CNPJ).
  The original `(tenant_id, external_id)` unique index can stay too.
- `active` column default stays `true`; the **sync** inserts `false` explicitly
  and never overwrites `active` on update (preserves the toggle).
- **No token column** — the API key is per-tenant, already stored.

### 6.2 `core.store_cluster` (new)

| Column | Type |
|---|---|
| `id` | `uuid` PK |
| `tenant_id` | `uuid` FK → `core.tenant(id)` `ON DELETE CASCADE` |
| `name` | `text` |
| timestamps | BaseEntity |

### 6.3 tenant `product_item` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | BaseEntity |
| `product_id` | `uuid` | FK → `product(id)` `ON DELETE CASCADE` |
| `store_id` | `uuid` | logical ref → `core.tenant_store(id)` |
| `price` | `numeric(12,2)` nullable | per-store sell price |
| `price_offer` | `numeric(12,2)` nullable | offer price (global value, see §9) |
| `cost` | `numeric(12,4)` nullable | per-store cost |

- Unique `UQ_PRODUCT_ITEM` on `(product_id, store_id)`; index on `store_id`.

### 6.4 A7Pharma read entities

- **`unidadenegocio`** — `@Entity({ name: 'unidadenegocio', schema: 'public',
  synchronize: false })`. Verified columns: `id bigint`, `status char(1)`,
  `codigo`, `nome`, `cnpj`, `nomefantasia`, `razaosocial`, … (no token). Repo
  `findAllActive()` filters `status = 'A' AND cnpj IS NOT NULL`.
- **`precoembalagemunidadenegocio`** — `(id, embalagemid, unidadenegocioid,
  precovenda, markup, precoreferencial, …)`. Source for per-store `price`.

## 7. HTTP surface

**Tenant-admin only** (`src/tenant-api/...`, `@Roles(UserRole.ADMIN)` + guard),
resolving `tenant_id` from context and reading/writing `core.*` via raw `em.query()`.

| Method | Route | Description |
|---|---|---|
| `GET` | `/stores` | list the tenant's stores (with cluster) |
| `PUT` | `/stores/:id` | update `active` and/or `cluster_id` |
| `GET` | `/store-clusters` | list clusters |
| `POST` | `/store-clusters` | create cluster (`name`) |
| `PUT` | `/store-clusters/:id` | rename |
| `DELETE` | `/store-clusters/:id` | delete (stores get `cluster_id = null`) |
| `POST` | `/products/:ean/price` | **changed:** body now requires `storeId` |

DTOs with `class-validator` (`@IsBoolean`, `@IsUUID`, `@IsOptional`).

## 8. Phases

### Phase 0 — Data model
- Extend `TenantStoreEntity` (add `cnpj`, `clusterId`; keep `externalId`) +
  `StoreClusterEntity` + `ProductItemEntity` + `UnidadeNegocioEntity` +
  `PrecoEmbalagemUnidadeNegocioEntity`.
- Migrations: `core/` (add columns + unique `(tenant_id, cnpj)`; create
  `store_cluster`) and `tenant/` (create `product_item`). Raw-SQL style.

### Phase 1 — Sync
- `SyncStoresStep`: read `unidadenegocio` where `status = 'A'`; upsert into
  `core.tenant_store` by `(tenant_id, cnpj)` — set `external_id`, `name`;
  insert `active=false`; never touch `active` on existing rows; skip rows w/o CNPJ.
- `SyncProductItemsStep`: for each **active** store only, upsert
  `product_item` per `(product, store_id)` using the store's
  `external_id`:
  - `price` ← `precoembalagemunidadenegocio(embalagemid, external_id).precovenda`
    (fallback `embalagem.precovenda`);
  - `cost` ← `custoproduto(produtoid, external_id).custo`;
  - `price_offer` ← global `itemcadernooferta.precooferta` (see §9).

### Phase 2 — APIs
- Tenant-admin controllers/services from §7 + registration in `TenantApiModule`.

### Phase 3 — Per-store price write-back
- `A7PharmaApiClient.changePrices` item gains optional `idUnidadeNegocioPreco`.
- `CatalogMutationService.updatePrice(...)` takes `storeId`, loads the
  store's `external_id`, sends it as `idUnidadeNegocioPreco`, and mirrors
  `product_item.price`. `UpdatePriceDto` gains `storeId: uuid`.

## 9. Decisions and items to confirm

**Confirmed**
- Reuse `core.tenant_store`; add `cnpj`, `cluster_id`; **keep `external_id`**
  (needed for per-store read/write). Dedup/match by **CNPJ**. ✅
- Sync from `unidadenegocio`, filter `status = 'A'`. Real columns verified. ✅
- **No per-store token / connection** — one API key + one connection per
  tenant; store targeting via `idUnidadeNegocioPreco`. ✅
- Per-store **price** ← `precoembalagemunidadenegocio`; **cost** ← `custoproduto`;
  **offer price is global**. ✅
- `product_item` references store by **core uuid** (`store_id`). ✅
- Management APIs are **tenant-admin-only**. ✅
- **`price_offer`**: mirror the global `itemcadernooferta.precooferta` into every
  active store's `product_item` (it's the per-store read surface). ✅
- **Write-back fields**: send only `precoVendaNovo` (current behavior);
  `precoReferencialNovo` (reference/cost) is out of scope for a sell-price
  update. ✅

> **Security note:** live ERP credentials (DB passwords + API key) were shared in
> chat. Rotate them after this investigation; store only via the encrypted
> integration config — never in the repo or plan.

## 10. Checklist

- [ ] Phase 0: entities + migrations (build green)
- [ ] Phase 1: `SyncStoresStep` (CNPJ, `status='A'`) + `SyncProductItemsStep` (active only; price/cost by `external_id`)
- [ ] Phase 2: store + cluster tenant-admin APIs
- [ ] Phase 3: write-back with `idUnidadeNegocioPreco` + mirror into `product_item`
- [ ] Unit tests (`*.spec.ts`, mock `em`/credentials)
