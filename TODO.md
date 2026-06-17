# Farmacore — Pending work

Tracked follow-ups surfaced while getting the pipeline + competitor import working end-to-end. Roughly ordered by priority.

## Scrapers
- [ ] **Add the `PAGUE_MENOS` scraper.** Port `legacy-app/src/services/pague-menos.service.ts` to `src/scrapers/pague-menos/`. Implement `ProductScraper` (and `StockScraper` if the legacy service fetched stock). Then register it in `src/scrapers/scrapers.module.ts`, add the `scraperFor` case in `src/pipeline/steps/import-competitor-products.step.ts`, add a `PAGUE_MENOS` entry to `PER_ORIGIN_STEPS`/`STEP_PREFETCH` in `src/queue/constants.ts`, and a batch consumer in `import-competitor-products.batch.consumers.ts`.
- [ ] **Add the `IKESAKI` scraper.** Same as above, porting `legacy-app/src/services/ikesaki.service.ts` to `src/scrapers/ikesaki/`.
- [ ] Once both exist, they can be enabled per-tenant via `PUT /admin/tenants/:slug/competitor-origins`. **Until then, do NOT enable `PAGUE_MENOS`/`IKESAKI`** — the dispatcher would emit batches to per-origin queues with no consumer/scraper and the step's fan-in would never close (stalls the run).

## Images / R2
- [ ] **Set `R2_PUBLIC_DOMAIN` in prod** (`fly secrets set --app farmacore-api` / `farmacore-worker`). Images are uploaded to R2, but stored URLs currently fall back to `R2_ENDPOINT/bucket/key`, which isn't publicly servable. Point it at the bucket's `r2.dev` binding or a custom domain.
- [ ] **Restore image resize** (legacy used `sharp` 800×800 / jpeg q80). Skipped in `R2StorageService` to avoid a native dep in the Alpine image; revisit if storage size/bandwidth matters (sharp ships prebuilt musl binaries, just needs Dockerfile validation).

## Retry / resilience
- [ ] **Block-aware retry with backoff for competitor scrapes.** Today a 403/429 block is swallowed by the scraper (`found:false`) and never retried — the only retry is the next full daily run. Distinguish block (403/429) from genuine not-found, then either let it throw → DLQ + a scheduled replay, or add a delayed-retry queue (RMQ TTL + DLX) with exponential backoff and a max-attempts cap. (DROGASIL is currently 403-blocked end-to-end.)

## Schema / config placement (see PR #4)
- [ ] After PR #4 merges, **other per-tenant CONFIG tables are candidates to move to `core`** too (same rationale as `tenant_competitor_origin`): `tenant_subsidiary`, `price_rounding_rule`, `price_rounding_decimal_range`, `scheduling`, `status_settings`. `offer_book_rule` is borderline (config but used operationally). Operational data stays in the tenant schema (product, product_stock, product_override, offer books, classifications, campaigns, audit reports).
- [ ] On the prod deploy that ships PR #4, confirm `migrate-all-tenants` ran the `1700000000004` drop migration for every tenant schema (removes the now-dead per-tenant `tenant_competitor_origin`).

## Prod hygiene
- [ ] **Consolidate prod system admins.** `core."user"` has both `admin@farmacore.local` (original, password unknown) and `admin@system.local` (re-seeded this session). Keep one. SQL drafted — delete the redundant admin + the leaked test data (`demo` tenant + `admin@demo.local`, orphan `qa@smoke.local`).
- [ ] **Set `SEED_ADMIN_PASSWORD` as a Fly secret** so the system-admin password is of-record, not just wherever it was typed.
- [ ] **Guard seed/smoke scripts against prod.** `demo`/`qasmoke` got created by running onboarding/smoke flows against the prod API. Consider refusing to run `seed-*`/`smoke-integration` when `DATABASE_URL` isn't local.

## Docs
- [ ] `CONTROLLER_MAPPING.md` `GET /products/export` (legacy) is still ❌ — no bulk export endpoint in the new app yet.
