# sync-base-product-stock — end-to-end validation

Run the v2 dispatcher/batch port against a real A7Pharma ERP after
sync-base-product has filled `shared_catalog.base_product` and
`product`.

## Prerequisites

Same as sync-base-product (see sibling doc). Plus optional but
recommended: seed `tenant_subsidiary` rows so the imported stock has
human-readable store labels.

```sql
SET search_path TO tenant_acme;

INSERT INTO tenant_subsidiary (external_id, name) VALUES
  (1, 'LOJA 1'),
  (12023529, 'LOJA 2'),
  (12025902, 'LOJA 3');
```

Stock for stores not in `tenant_subsidiary` still imports — the table
is pure labeling.

## Running

The chain fires automatically from sync-base-product's last batch
(publishes `sync-base-product-stock.dispatch`). Same trigger script
as sync-base-product, no extra invocation needed.

## Verifying

```sql
SELECT step, batch_seq, status, batches_planned, batches_done
FROM core.pipeline_run
WHERE pipeline_run_id = '<paste runId>'
  AND step LIKE 'sync-base-product-stock%'
ORDER BY batch_seq;
```

Expected:
- one dispatch row (`batch_seq=0`, `status='completed'`,
  `batches_planned=N`, `batches_done=N`).
- N batch rows (`batch_seq=1..N`, `status='completed'`).
- one `branch.stock-a` row (from `PipelineJoinService.markBranchComplete`).
  When the import-competitor-stock branch closes too, the join fires
  CALC_BASE_PRODUCT_METRICS.

```sql
SET search_path TO tenant_acme, shared_catalog, public;

SELECT COUNT(*) FROM product_stock;
SELECT subsidiary_external_id, SUM(quantity)
FROM product_stock
GROUP BY subsidiary_external_id
ORDER BY subsidiary_external_id;

-- Spot-check a known EAN
SELECT tps.ean, tps.subsidiary_external_id, ts.name AS store, tps.quantity
FROM product_stock tps
LEFT JOIN tenant_subsidiary ts
  ON ts.external_id = tps.subsidiary_external_id
WHERE tps.ean = <known ean>;
```

## Common surprises

- **`product_stock` empty for an EAN you expect**: the embalagem
  has no parseable `codigobarras` (length > 14, non-numeric only,
  empty) — those are silently skipped (legacy behavior; counted in
  `skipped`).
- **`product_stock` empty for a store**: the store has no
  `estoque` rows with quantity > 0 in this snapshot, or the
  embalagem's stock is exactly 0. Zero-quantity rows are dropped by
  design (legacy did the same).
- **Stock disappeared between runs**: the batch consumer
  bounded-deletes by EAN before upserting, so a subsidiary that
  vanished from the ERP for an EAN is removed in the same batch that
  refreshes its peers.
