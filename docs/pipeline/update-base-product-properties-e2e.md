# update-base-product-properties — end-to-end validation

Four passes over the EAN universe, all driven by a single dispatcher
+ batch consumer pair. Each pass backfills missing fields using
`shared_catalog.product` (DROGASIL preferred over DROGAL, matching
legacy fall-through).

| Pass | Source columns | Target |
|---|---|---|
| supplier | product.supplier ?? product.brand | tenant_product.supplier |
| name | product.name | tenant_product.name |
| weight | product.weight | shared_catalog.base_product.weight |
| measures | product.{height,length,width,weight} | shared_catalog.base_product.{height,length,width,weight} |

All writes are guarded by `WHERE target IS NULL`, so two tenants
running in parallel both pulling from shared_catalog.product end up
with the first-writer-wins value and the second's UPDATE is a no-op.

## Prerequisites

- B1+B2+B4 ran (tenant_product + base_product populated).
- Phase C ran for the run (shared_catalog.product has DROGAL/DROGASIL
  rows with supplier/brand/weight/height/length/width set). Until C
  lands, `shared_catalog.product` is empty and B5 is a no-op — all
  four passes return zero candidates because the join has nothing on
  the right side.

## Running

Fires as the successor of calc-base-product-metrics. No manual
trigger needed.

## Verifying

```sql
SELECT step, batch_seq, status, batches_planned, batches_done
FROM core.pipeline_run
WHERE pipeline_run_id = '<paste runId>'
  AND step = 'update-base-product-properties'
ORDER BY batch_seq;
```

Expected: one dispatch row + N batch rows (sum across all four
passes), all `completed`. The dispatch row's `batches_planned` is the
sum; you can't tell from the table alone how many came from each
pass — check worker logs for the per-pass debug lines.

```sql
SET search_path TO tenant_acme, shared_catalog, public;

-- Suppliers + names backfilled per tenant
SELECT ean, supplier, name FROM tenant_product
WHERE supplier IS NOT NULL OR name IS NOT NULL LIMIT 20;

-- Dimensions backfilled in shared catalog
SELECT ean, weight, height, length, width FROM shared_catalog.base_product
WHERE weight IS NOT NULL OR height IS NOT NULL LIMIT 20;
```

## Common surprises

- **Zero updates across the board**: no Phase C data yet, OR
  `shared_catalog.product` exists but the new columns
  (supplier/brand/weight/dimensions) are all null because the scraper
  didn't populate them. Inspect a sample row.
- **`shared_catalog.base_product` weight set but per-tenant
  `tenant_product.supplier` still null**: weight is shared (population
  is global), supplier is per-tenant. The supplier pass picks
  candidates from `tenant_product.supplier IS NULL`; if your tenant
  hasn't run B5 against current scrape data, those rows stay null.
- **DROGAL has data, DROGASIL doesn't, but B5 reads zero on the
  measures pass**: DROGASIL is preferred but we fall through to
  DROGAL if it has any dimension. If both are missing dimensions, the
  EAN is dropped (legacy parity).
