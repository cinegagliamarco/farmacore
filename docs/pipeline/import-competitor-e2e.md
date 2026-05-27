# import-competitor-products + import-competitor-stock — end-to-end validation

Phase C steps. Hits real vendor APIs (Drogal, Drogasil, Michelassi),
so plan the validation with care — see the **safety** section below
before running against full tenant data.

## Architecture

Two steps, each a dispatcher fanning out to per-origin batch queues
under one fan-in counter per step:

```
import-competitor-products.dispatch
   ├── import-competitor-products.DROGAL      (batch 20 EANs, prefetch 8)
   ├── import-competitor-products.DROGASIL    (batch 10 EANs, prefetch 8)
   └── import-competitor-products.MICHELASSI  (batch  1 EAN,  prefetch 2)

import-competitor-stock.dispatch
   ├── import-competitor-stock.DROGAL         (batch 50 SKUs, prefetch 4)
   └── import-competitor-stock.DROGASIL       (batch 30 SKUs, prefetch 4)
```

All per-origin batches share one dispatch row's counter; the LAST
batch from any origin closes the run. Stock's last batch also marks
`stock-b` via PipelineJoinService — CALC fires only when sync-base-
product-stock's `stock-a` is also done.

## Prerequisites

- B1+B2+B4+B5 ran (product populated; shared_catalog.product
  ready to receive scrape data).
- `tenant_competitor_origin` rows for the origins the tenant cares
  about, with `enabled = true`. Example seed (run after tenant
  provisioning):

  ```sql
  SET search_path TO tenant_acme;
  INSERT INTO tenant_competitor_origin (origin, enabled, priority) VALUES
    ('DROGAL', true, 100),
    ('DROGASIL', true, 100),
    ('MICHELASSI', true, 100);
  ```

## Safety — read before running

- **Real HTTP**: scraping hits the vendors' production sites with
  your developer / Fly worker IP. Triggering anti-bot can block your
  IP for hours.
- **Validate with a small EAN sample first**: limit `product`
  to ~10 known EANs (delete the rest temporarily, or test against a
  fresh tenant with only those EANs).
- **Drogasil's search page is HTML-streamed**; if the page layout
  changes the SKU regex (`<article data-item-id="...">`) will
  silently return no SKU. Monitor the dispatch row vs. zero
  shared_catalog.product writes for that origin.

## Triggering

The whole chain fires from `pipeline.start` (cron midnight UTC or
manual trigger). After B5 completes, the run automatically advances
through `import-competitor-products.dispatch` → per-origin batches →
`import-competitor-stock.dispatch` → per-origin batches → CALC.

For a one-off scrape of one EAN, write a small REPL script that
constructs a `pipeline.start` message and publishes it.

## Verifying

```sql
SELECT step, batch_seq, status, batches_planned, batches_done
FROM core.pipeline_run
WHERE pipeline_run_id = '<runId>'
  AND step LIKE 'import-competitor-%'
ORDER BY step, batch_seq;
```

Expected:
- one dispatch row per step (`batch_seq=0`, `batches_planned=N`,
  `batches_done=N`).
- N batch rows, all `completed`.

```sql
SET search_path TO shared_catalog, public;

-- Scraped products per origin
SELECT origin, COUNT(*) FILTER (WHERE name IS NOT NULL) AS found,
       COUNT(*) FILTER (WHERE name IS NULL) AS missing
FROM product GROUP BY origin;

-- Stock snapshots from this run (last 10 min)
SELECT p.origin, COUNT(*) AS snapshots, SUM(s.quantity) AS total_units
FROM product_stock s
JOIN product p ON p.id = s.product_id
WHERE s.captured_at > now() - interval '10 minutes'
GROUP BY p.origin;

-- Per-product failures (scraper returned error)
SELECT origin, ean, metadata->>'error' AS error
FROM product
WHERE metadata->>'error' IS NOT NULL
LIMIT 20;
```

## Common surprises

- **Drogal `metadata.isPbm = true` but price unchanged**: PBM detected
  via `PBM[].length` flag but `CustomData.pbmPrice` was missing /
  zero, so the regular Price was kept. Matches legacy behavior.
- **Drogasil `name` populated but `weight` null**: the GraphQL
  productBySku doesn't always return weight; legacy had the same
  gap.
- **Michelassi `metadata.stockBalance` set but no `product_stock`
  row**: Michelassi is products-only — stock arrives with the product
  fetch and lives in metadata, NOT in `shared_catalog.product_stock`.
- **429 retries on Michelassi**: scraper backs off 2s/4s/8s up to 3
  attempts. After that the batch throws and the standard pipeline
  retry/DLQ kicks in.
