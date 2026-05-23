# Pipeline throughput — dispatcher/batch design

> Working notes feeding **Plan 05 v2** (`../05-pipeline-steps.md`). Source for the queue topology, prefetch numbers, and the rationale behind not porting the legacy in-process for-loop with `global.gc()`.

## What the legacy does

[`legacy-app/src/cron/daily-routines.cron.ts`](../../legacy-app/src/cron/daily-routines.cron.ts) runs all 8 steps inside one Node process, sequentially, with manual `global.gc()` calls every 30-50 items to stay alive. The hot ones are:

| Legacy use-case | Items per run | Per-item work | Memory tricks |
|---|---|---|---|
| `synchronize-base-product` | ~36k embalagem | batch DB lookups + upsert | batch=1000, no gc |
| `synchronize-base-product-stock` | ~36k embalagem | per-item EAN lookup + N upserts | batch=1000 |
| `synchronize-offer-books-info` | ~100 offers | bulk mapping | trivial |
| `import-competitor-products` | ~36k EAN × 3 origins | **HTTP scrape per EAN** | batch=1/10/20 + `global.gc()` every 30-50 |
| `import-competitor-stock` | ~36k × 2 origins | batch HTTP fetch | batch=30/50 + 5s sleep between batches |
| `synchronize-base-product-metrics` | ~36k base_product | margin/variation calc | batch=1000 |
| `generate-base-product-properties` | ~36k × 4 passes | 2 DB reads + 1 save | batch=1000 per pass |
| `update-active-ingredient-mat` | ~36k aggregate | bulk SQL | none |

Bottom line: **~108k HTTP scrapes + ~145k DB roundtrips in one process**. `global.gc()` is a smell — it means the process was leaking transient batches faster than V8 could free them on its own.

## Why we don't port that shape

1. **Single process == single failure domain.** If Michelassi flaps for 5 minutes on the 17k-th EAN, the whole pipeline restarts from step 1.
2. **`global.gc()` doesn't compose.** Add a second tenant and the workaround stops working — two tenants double the heap pressure.
3. **No backpressure.** Legacy uses `setTimeout` delays between batches; we want the broker's prefetch to act as the rate limiter.
4. **No restart recovery.** Crash mid-step → redo from the top of that step.

## What we do instead — dispatcher/batch

Each heavy step is split in two queues:

```
<step>.dispatch          # 1 message per (tenant, run) — reads source, emits N batch messages
<step>.batch             # N messages per (tenant, run) — each does ~100-500 rows
```

- The **dispatcher** is read-mostly. It runs one SQL `SELECT id FROM source LIMIT N OFFSET M`-style scan and produces `ceil(total / batchSize)` batch messages with `{ runId, tenantId, ids: [...] }`.
- The **batch consumer** receives the IDs, does the per-row work, ack's. Memory footprint = one batch (≤500 rows) instead of the whole 36k set.

### Fan-in (replaces the v1 two-branch join)

The base consumer today returns `{ successors }` after a single piece of work. With N batches per step we need a **counter**:

- On dispatch, write `core.pipeline_run.dispatch` row: `{ runId, step, batchesPlanned: N, batchesDone: 0 }`.
- Each batch consumer, after success, executes `UPDATE … SET batches_done = batches_done + 1 RETURNING batches_done, batches_planned`.
- The batch that observes `batches_done == batches_planned` is the LAST one — it publishes the successor.

This is atomic via the row update and survives redelivery (the counter only goes up; the `(runId, step, batch_seq)` row in `pipeline_run` provides idempotency for individual batches).

### Per-origin queues for scrapers

`import-competitor-products` is special — three external services with different rate limits. We split by origin so one slow vendor doesn't head-of-line block the others:

```
import-competitor-products.dispatch    # publishes to N origin queues based on tenant_competitor_origin
import-competitor-products.drogal      # one message per EAN (or small batch)
import-competitor-products.drogasil
import-competitor-products.michelassi
```

`import-competitor-stock` follows the same split (2 origins for stock in legacy).

The dispatcher reads `tenant_competitor_origin` to know which queues to publish to. Disabling an origin = nothing dispatched for that origin = nothing in flight.

## Topology table

| Queue | Per-message work | Items/run | Batch | Prefetch | Concurrency knob | Why |
|---|---|---|---|---|---|---|
| `pipeline.start` | fan out to step 1 + step 3 | 1 | — | 1 | 1 | trivial |
| `sync-base-product.dispatch` | scan integration `embalagem`, emit batches | 1 | — | 1 | 1 | one-shot per run |
| `sync-base-product.batch` | upsert N base_product rows | ~72 | 500 | 4 | per-worker concurrency | DB write throughput; Neon pooled |
| `sync-base-product-stock.dispatch` | emit per-embalagem-batch msgs | 1 | — | 1 | 1 | |
| `sync-base-product-stock.batch` | per-EAN stock upserts | ~72 | 500 | 4 | | DB write |
| `sync-offer-books-info` | bulk upsert from `caderno_oferta` | 1 | — | 1 | 1 | small set, no need to split |
| `import-competitor-products.dispatch` | read enabled origins, fan out | 1 | — | 1 | 1 | |
| `import-competitor-products.drogal` | scrape 1 EAN | ~36k | 1 | **8** | 8 in-flight scrapes | Drogal legacy: batch=20, delay=200ms ⇒ ~50 req/min/worker; 8 in-flight matches |
| `import-competitor-products.drogasil` | scrape 1 EAN | ~36k | 1 | **8** | 8 | similar pacing |
| `import-competitor-products.michelassi` | scrape 1 EAN | ~36k | 1 | **2** | 2 | legacy: batch=1, delay=350ms ⇒ ~170 req/min total; keep low |
| `import-competitor-stock.dispatch` | read products by origin, fan out | 1 | — | 1 | 1 | |
| `import-competitor-stock.drogal` | batch HTTP stock fetch + upsert | ~720 | 50 | 4 | | legacy batch=50 + 5s sleep |
| `import-competitor-stock.drogasil` | batch HTTP stock fetch + upsert | ~1200 | 30 | 4 | | legacy batch=30 + 5s sleep |
| `calc-base-product-metrics.dispatch` | scan base_product, emit batches | 1 | — | 1 | 1 | |
| `calc-base-product-metrics.batch` | join product, compute margin/variation, save | ~72 | 500 | **2** | | CPU + DB; lower to leave headroom |
| `update-base-product-properties.dispatch` | 4 passes (supplier/weight/name/measures) | 1 | — | 1 | 1 | emits per-pass batch msgs |
| `update-base-product-properties.batch` | 2 DB reads + 1 update per row | ~290 | 500 | 4 | | DB-bound |
| `update-active-ingredient-mat` | bulk SQL aggregate (no batching) | 1 | — | 1 | 1 | single statement |

Approximate message volume per run (one tenant, 36k base_products): **~108k** (dominated by scrape queues). Per tenant. With 10 tenants nightly that's ~1.1M messages in a 4-hour window — well inside CloudAMQP Tiger's quotas (1M msgs/day on Tiger; bigger plans available, but scrape queues dominate and they're long-running so per-day throughput is what matters, not peak).

> **Reminder:** these prefetch numbers are starting points. The right way to tune them is to watch (a) the broker's "unacked" gauge per queue and (b) Neon's `pg_stat_activity` connection count during a real run. The notes here are guesses informed by legacy code, not measured. Treat plan 07's observability work as the prerequisite for any further tuning.

## Why not bigger batches?

- **Per-batch transaction size.** A batch of 5000 in a single transaction holds Postgres row locks for that long. Plan 02's `runWithTenant` wraps every batch in a tenant-scoped tx; long txs hurt other tenants' latency. 500 is a comfortable upper bound on Neon pooled.
- **Retry granularity.** Legacy retries the whole loop on failure. With batch=500, a transient HTTP timeout on batch #42 only retries 500 EANs, not 36k.
- **Memory.** A `JSON.stringify` of 500 EAN+payload pairs is ~50KB on the wire; 5000 starts pushing message size limits and AMQP frame overhead.

## Why not per-row scrape messages with prefetch=1?

For scrape queues, we DO use batch=1 (per-EAN), because:
- Each scrape is its own HTTP call. Batching 50 EANs into one message and serializing the scrapes inside the consumer gives us nothing — it just defers the work and makes redelivery less granular.
- The prefetch number (e.g. 8 for Drogal) IS the concurrency. We want 8 scrapes in flight simultaneously.
- A failed scrape retries that one EAN, not 50.

For DB-bound queues (sync, calc, props), batch=500 makes sense because the per-row cost is dwarfed by tx setup; bundling amortizes.

## Open question — dispatch idempotency

If `pipeline.start` is delivered twice (broker redelivery), the dispatcher will try to publish 72 batch messages twice → 144 batches enqueued → 36k rows get double-processed (every base_product upserted twice, with the same values).

Two options:
1. **Idempotent payloads.** Each batch carries a deterministic `batch_seq` (0..71). The batch consumer's idempotency row in `pipeline_run` keys on `(runId, step, batch_seq)`, not just `(runId, step)`. Second copy of batch #5 sees the existing completed row and exits early.
2. **Dispatcher locks.** Dispatcher inserts `(runId, step.dispatch)` with `status=running` first; the second copy sees the row and exits without dispatching.

Option 1 is the safer pattern (no race between insert + check). Plan 05 v2 should adopt it: extend `PipelineRunService.start` to accept an optional `batchSeq` and key the unique constraint on `(runId, step, batchSeq)` instead of `(runId, step)`.

## Where this lives

- This document — design rationale + numbers
- `plans/05-pipeline-steps.md` — amended to point at this design (see post-execution amendment block at the top)
- `src/queue/constants.ts` — `STEP_PREFETCH` map will gain per-origin entries when the per-origin queues land
- `migrations/core/...` — `pipeline_run` UNIQUE index changes to include `batch_seq`

None of this is implemented yet. Plan 05 v1 shipped stubs; v2 (this design) is what fills them in.
