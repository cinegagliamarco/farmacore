# sync-offer-books-info — end-to-end validation

Single-shot step: reads every `caderno_oferta` from the ERP and
upserts into `tenant_offer_campaign`. Volume is small (~100 rows
per tenant), no dispatch/batch split.

## Running

Fires automatically as a successor of `pipeline.start` (the
PipelineStartConsumer publishes both `sync-base-product.dispatch`
and `sync-offer-books-info`). Same trigger script as the other steps.

## Verifying

```sql
SELECT step, batch_seq, status
FROM core.pipeline_run
WHERE pipeline_run_id = '<paste runId>'
  AND step = 'sync-offer-books-info';
```

Expected: one row, `batch_seq=0`, `status='completed'` (single-shot
uses the v1 BasePipelineConsumer — one row per (run, step)).

```sql
SET search_path TO tenant_acme, public;

SELECT external_id, name, active, start_date, expiration_date
FROM tenant_offer_campaign
ORDER BY external_id;

-- Admin UI's "active and not expired" filter:
SELECT *
FROM tenant_offer_campaign
WHERE active = true
  AND (expiration_date IS NULL OR expiration_date >= now());
```

## Common surprises

- **Empty `tenant_offer_campaign`**: the ERP `caderno_oferta` table has
  no rows for this tenant. Confirm in the integration DB directly.
- **Stale rows**: campaigns deleted from the ERP stay in
  `tenant_offer_campaign` until a follow-up cleanup pass runs. Same
  trade-off as `offer_book` — accepted for v2.
- **`start_date` null**: legacy A7Pharma sometimes leaves
  `datahorainicial` empty. Mapped to null verbatim; the admin UI
  treats null as "open-ended".
