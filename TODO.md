# Farmacore — Pending work

Follow-ups still open. Done since the first cut: PAGUE_MENOS + IKESAKI scrapers,
all per-tenant config tables moved to `core`, stock+image folded into the
per-product import (stock no longer gated behind product-only origins), the
`demo` test tenant removed from prod, and a local-only guard on
`seed:local-tenant`.

## Code (doable here)
- [ ] **Block-aware retry with backoff for competitor scrapes.** A 403/429 block is currently swallowed as `found:false` and only retried on the next full run. Distinguish block (403/429) from genuine not-found, then either throw → DLQ + scheduled replay, or add a delayed-retry queue (RMQ TTL + DLX) with exponential backoff + max-attempts. (DROGASIL is 403-blocked end-to-end today.)
- [ ] **`GET /products/export`** — legacy bulk export of `shared_catalog` competitor data has no equivalent yet (`CONTROLLER_MAPPING.md` shows it ❌).
- [ ] **Image resize** (optional) — legacy used `sharp` (800×800 / jpeg q80) before R2 upload; skipped to avoid a native dep in the Alpine image. Revisit if storage/bandwidth matters.

## Needs infra / prod access (your action)
- [ ] **Set `R2_PUBLIC_DOMAIN`** as a Fly secret on `farmacore-api` + `farmacore-worker`. Images upload to R2, but stored URLs fall back to `R2_ENDPOINT/bucket/key` (not publicly servable) until this points at a custom domain or the bucket's `r2.dev` binding.
- [ ] **Consolidate prod system admins.** `core."user"` has both `admin@farmacore.local` (password unknown) and `admin@system.local` (re-seeded this session). Keep one; SQL drafted earlier.
- [ ] **Set `SEED_ADMIN_PASSWORD`** as a Fly secret so the system-admin password is of-record.

## Ops note
- Prod `import-competitor-products` DLQ may still hold old cruft (an early run + a calc batch). Harmless; purge from the CloudAMQP UI if you want a clean board (no broker API access from here).
