# calc-base-product-metrics — end-to-end validation

Computes `margin`, `average_variation`, `status` for every
`product`. Dispatcher chunks all EANs into batches of 500; each
batch joins product with shared_catalog.product (DROGAL +
DROGASIL competitor prices) and tenant.offer_book (target_price),
computes the three metrics, and bulk-updates in one SQL statement.

## Prerequisites

- B1 + B2 ran (product populated).
- Competitor price source is `shared_catalog.product` (origin = DROGAL
  or DROGASIL). Until Phase C lands `import-competitor-products`, that
  table is empty and `average_variation` + `status` come out null —
  margin still works (uses cost + price/target_price only).
- Optional: a `status_settings` row with custom thresholds, e.g.

  ```sql
  SET search_path TO tenant_acme;
  INSERT INTO status_settings (settings)
  VALUES ('{"suspectBelow": -15, "attentionBelow": 0, "attentionAbove": 20, "suspectAbove": 50}'::jsonb);
  ```

  Defaults (matching legacy) apply if no row exists.

## Running

Fires as the join successor of (sync-base-product-stock +
import-competitor-stock). Same trigger script as the earlier steps.

## Verifying

```sql
SELECT step, batch_seq, status, batches_planned, batches_done
FROM core.pipeline_run
WHERE pipeline_run_id = '<paste runId>'
  AND step = 'calc-base-product-metrics'
ORDER BY batch_seq;
```

Expected: one dispatch row + N batch rows, all `completed`.

```sql
SET search_path TO tenant_acme, shared_catalog, public;

SELECT status, COUNT(*) FROM product GROUP BY status ORDER BY status;

-- Spot-check the math for a known ean
SELECT ean, price, cost, margin, average_variation, status
FROM product WHERE ean = <known ean>;
```

## Common surprises

- **`status` null on every row**: no competitor prices exist in
  `shared_catalog.product` (Phase C hasn't populated). Expected pre-C.
- **`margin` null but `average_variation` set**: cost is null/zero.
  Legacy treated this the same — basePrice > 0 is required for margin.
- **`average_variation` null but `margin` set**: one or both of
  `drogal.price` / `drogasil.price` is null/zero. Both must be > 0 for
  averageVariation to compute.
