# Legacy → New Cron / Routine Mapping

Maps every scheduled job in [`legacy-app/src/cron/`](./legacy-app/src/cron/) to its place in the new app. Companion to [`CONTROLLER_MAPPING.md`](./CONTROLLER_MAPPING.md) and the routine-separation design in [`plans/10-routine-separation.md`](./plans/10-routine-separation.md).

## The big change

Legacy ran **one daily cron** (`DailyRoutinesCron`) that did all 8 steps sequentially for the single tenant. The new app is multi-tenant and separates **per-tenant** work from **system/shared** work into four sequenced routines, so the shared competitor scrape runs **once** instead of once-per-tenant:

| New routine | Scope | Replaces (legacy steps) |
|---|---|---|
| **Tenant import** | per tenant | 1 synchronizeBaseProduct (tenant data), 2 synchronizeBaseProductStock, 3 synchronizeOfferBooksInfo |
| **Build base products** | system (all tenants → `shared_catalog.base_product`) | the `base_product` half of step 1 |
| **Shared catalog sync** | system (once) | 4 importProducts, 5 importStocks, 7 (base_product weight/dims) |
| **Tenant metrics** | per tenant | 6 calculateBaseProductMetrics, 7 (tenant supplier/name), 8 updateActiveIngredientMat |

## Legend

- ✅ **Exists** — equivalent runs in the new app today
- 🆕 **To build** — covered by plan 10
- ⛔ **Blocked** — needs a feature not yet ported
- ❌ **Dropped** — intentionally not carried over

---

## Daily pipeline (`DailyRoutinesCron` — midnight, sequential)

| # | Legacy step | New routine | Status | Notes |
|---|---|---|---|---|
| 1 | `synchronizeBaseProduct` | Tenant import (`sync-base-product`) + Build base products | 🆕 | Tenant data stays in `sync-base-product`; the `base_product` write moves to the system "Build base products" routine that aggregates across all tenants. |
| 2 | `synchronizeBaseProductStock` | Tenant import (`sync-base-product-stock`) | ✅ | Already a step; moves under the tenant-import routine. |
| 3 | `synchronizeOfferBooksInfo` | Tenant import (`sync-offer-books-info`) | ✅ | Already a step. |
| 4 | `importProducts` (Drogal/Drogasil/Michelassi) | Shared catalog sync (`import-competitor-products`) | 🆕 | Becomes **system-scoped, once** over the `base_product` EAN universe (was per-tenant). |
| 5 | `importStocks` (Drogal/Drogasil) | Shared catalog sync (`import-competitor-stock`) | 🆕 | System-scoped, once. |
| 6 | `calculateBaseProductMetrics` | Tenant metrics (`calc-base-product-metrics`) | ✅ | Already a step; moves under the tenant-metrics routine (runs after the shared sync). |
| 7 | `updateBaseProductProperties` | Shared catalog sync (weight/dims) + Tenant metrics (supplier/name) | ✅ | Already a step; the two passes land in different routines by what they write. |
| 8 | `updateActiveIngredientMat` | Tenant metrics | 🆕 | Not yet a step in the new app — new work in plan 10. |

Daily cron itself: legacy `@Cron(EVERY_DAY_AT_MIDNIGHT)` single job → split into **tenant-import**, **system-catalog**, **tenant-metrics** crons (current `DailyPipelineCron` is the seed). Fan-in between them is decision B in plan 10.

## Periodic routines (`PeriodicRoutinesCron`)

| Interval | Legacy routine | New routine | Status | Notes |
|---|---|---|---|---|
| every 5 min | `updateProductsWithErrorsOrOutdated` | "re-scrape errored products" (system periodic) | 🆕 | Re-scrape `shared_catalog.product` rows where `metadata.error` is set or the row is stale. Reuses the per-origin scrape queues. |
| every 5 min | `updateStockWithErrorsOrOutdated` | "re-scrape errored stock" (system periodic) | 🆕 | Same shape for competitor stock. |
| every 1 min | `executeSchedulings` | — | ⛔ | Needs the **scheduling** feature (DB-driven price / offer-price updates). `scheduling.controller` is ❌ in CONTROLLER_MAPPING. |
| hourly 07–21 | `executeScheduledOfferBookRules` | — | ⛔ | Needs the **offer-book-rules** feature (`offer-book-rules.controller` is ❌). |
| every 12 h | `restartApplication` | — | ❌ | Fly.io manages process lifecycle/restarts; the legacy "restart to free memory" workaround isn't needed. |

---

## Manual triggers (admin)

Independent of the crons, an admin can run any single routine on demand via
`POST /admin/tenants/:slug/pipeline/steps/:step` (see CONTROLLER_MAPPING.md →
"Triggerable routine"). The crons publish the same step messages on a schedule.
