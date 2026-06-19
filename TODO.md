# Farmacore — Pending / deferred

Items consciously deferred while building the tenant presentation API (Plan 10).

## Deferred from Plan 10 (revisit when needed)
- [ ] **`curve` / `book` / `mat` on `tenant.product`** — legacy `base_product` had these (sales curve A–D, catalog "book" label, marketing-analysis target). The new `tenant.product` does **not**. Proceeding without them (those filters/sorts/columns are omitted from the v1 tenant catalog API). **If we decide to add them:** new columns on `src/database/entities/tenant/product.entity.ts` (`curve text`, `book text`, `mat numeric(10,2)`) + a tenant migration (`migrations/tenant/`) + populate them in the `sync-base-product` step (`src/pipeline/...`) from the A7Pharma ERP fields, then re-add the filters in the catalog query/DTOs.
- [ ] **Per-ingredient `mat`** — legacy had an `active_ingredient` table carrying `mat`. New model only has `tenant.product.active_ingredient` (text). The active-ingredient grouping endpoint ships without per-ingredient `mat` (group by the text column). Add a tenant `active_ingredient` table if this is needed.
- [ ] **Customer product images** — legacy `base_product_image`. Not modelled (shared_catalog only has *competitor* images). Add `tenant.product_image` if the UI needs the customer's own images.
- [ ] **`GET /offer-books/info`** — not ported; response shape undefined in the legacy controller. Revisit if the FE needs offer-book summary info. (Offer write-back `POST`/`DELETE /products/:ean/offer` is done — caderno id stored as `offer_book.external_id`.)
- [ ] **Offer-book rule engine** — the whole `/offer-book-rules` surface (rules, pricing-rules, price-locks, execution-reports + async execution) is **Plan 11** (net-new tables; large). Not part of Plan 10.
- [ ] **Scheduling executor** — `core.scheduling` exists but has no executor. `/scheduling` deferred until a cron applies the actions.

## Operational (your side)
- [ ] Confirm Fly secrets `R2_PUBLIC_DOMAIN` + `SEED_ADMIN_PASSWORD` are set on `farmacore-api` and `farmacore-worker` (`fly secrets list`).
