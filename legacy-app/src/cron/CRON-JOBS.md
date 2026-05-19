# Cron Jobs

This document describes all scheduled tasks, their responsibilities, execution order, and data dependencies.

## Daily Pipeline (`DailyRoutinesCron`)

A single cron job at **midnight** that runs every step **sequentially** (each step awaits before the next starts). This guarantees no race conditions between steps that produce and consume data from one another.

| Step | Name | Reads | Writes | Why this order? |
|------|------|-------|--------|-----------------|
| 1 | **synchronizeBaseProduct** | ERP integration DB (`embalagem`, `caderno_oferta`, etc.) | `base_product`, `offer_book`, `classification` | Foundation — every other step depends on fresh `base_product` and/or `offer_book` rows |
| 2 | **synchronizeBaseProductStock** | ERP integration DB (`estoque`) + `base_product` (by EAN) | `base_product_stock` | Needs `base_product` rows from step 1 to look up IDs |
| 3 | **synchronizeOfferBooksInfo** | ERP integration DB (`caderno_oferta`) | `offer_book_info` | Independent of local tables, but placed here so `offer_book_info` is fresh before offer-book rules run later in the day |
| 4 | **importProducts** | `base_product` (EAN list) + external APIs (Drogasil, Drogal, Michelassi) | `product` | Needs `base_product` EANs from step 1; produces `product` rows consumed by steps 5, 6, and 7 |
| 5 | **importStocks** | `product` (by origin) + external APIs | `product_stock` | Needs `product` rows from step 4 |
| 6 | **calculateBaseProductMetrics** | `base_product` (with `offerBooks` relation) + `product` (Drogal, Drogasil, Michelassi prices) | `base_product` (margin, averageVariation, status) | Needs both `offer_book` from step 1 and `product` prices from step 4 |
| 7 | **updateBaseProductProperties** | `product` (Drogasil/Drogal for supplier, weight, name) | `base_product` (supplier, weight, name) | Needs `product` rows from step 4 |
| 8 | **updateActiveIngredientMat** | `base_product` | `active_ingredient` (MAT column) | Needs `base_product` from step 1 |

### Dependency Graph

```
Step 1: synchronizeBaseProduct
  ├─► Step 2: synchronizeBaseProductStock
  ├─► Step 4: importProducts
  │     ├─► Step 5: importStocks
  │     ├─► Step 6: calculateBaseProductMetrics (also needs Step 1)
  │     └─► Step 7: updateBaseProductProperties
  └─► Step 8: updateActiveIngredientMat

Step 3: synchronizeOfferBooksInfo (independent, reads from integration DB only)
```

## Periodic Routines (`PeriodicRoutinesCron`)

Interval-driven jobs that run throughout the day independently of the daily pipeline.

| Interval | Name | Description |
|----------|------|-------------|
| Every **1 minute** | `executeSchedulings` | Processes pending DB-driven price and offer-price update schedulings |
| Every **5 minutes** | `updateProductsWithErrorsOrOutdated` | Re-imports `product` rows that previously failed or are outdated |
| Every **5 minutes** | `updateStockWithErrorsOrOutdated` | Re-fetches stock for `product` rows with stock errors or outdated stock |
| Every **12 hours** | `restartApplication` | Graceful restart of the application; skipped if an import process is currently running |
| Hourly **07:00–21:00** | `executeScheduledOfferBookRules` | Executes offer-book pricing rules that are scheduled for the current day of the week. Starts at 07:00 to avoid overlapping with the daily pipeline |
