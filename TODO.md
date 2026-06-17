# Farmacore — Pending work

All code items are done. What's left is infra/ops you run directly (no code/PR).

## Remaining (your action — infra)
- [ ] **Set the two Fly secrets** on `farmacore-api` **and** `farmacore-worker` (values shared; not committed here):
  ```
  fly secrets set R2_PUBLIC_DOMAIN=https://product-images.macfarma.com.br SEED_ADMIN_PASSWORD='…' --app farmacore-api
  fly secrets set R2_PUBLIC_DOMAIN=https://product-images.macfarma.com.br SEED_ADMIN_PASSWORD='…' --app farmacore-worker
  ```
  `R2_PUBLIC_DOMAIN` only affects newly-uploaded images; existing `product_image` rows keep the fallback URL until re-scraped. Ensure the domain is bound to the R2 bucket.
- [ ] **Consolidate the two prod system admins** in `core."user"` (`admin@farmacore.local` + `admin@system.local`) — keep one (SQL drafted earlier). Needs DB access.

## Done
- PAGUE_MENOS + IKESAKI scrapers; all per-tenant config tables → `core`; per-product stock+image (stock no longer gated behind product-only origins); demo test tenant removed; `seed:local-tenant` guarded against non-local DBs.
- **Block-aware retry**: transient failures (429 / 5xx / network) retried with exponential backoff across all scrapers; persistent 403 still surfaces as `found:false` (needs scraper-level work, not generic retry).
- **`GET /products/export`**: paginated shared-catalog export (product + primary image + latest stock), optional `origin` filter.
- **Image resize**: `sharp` re-added (≤800×800, jpeg q80) before R2 upload, falling back to the original on failure.
