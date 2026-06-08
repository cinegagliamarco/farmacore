# Operator runbook — pipeline v2

Day-to-day operations for the pipeline (cron, manual triggers, stuck
states, DLQ debugging, outbox monitoring). Step-specific recipes
live in `docs/pipeline/*-e2e.md`; this is the cross-cutting view.

## Topology recap

```
pipeline.start
   ├── sync-base-product.dispatch ──► sync-base-product.batch ──┐
   └── sync-offer-books-info                                    │
                                                                ▼ (join via PipelineJoinService)
       sync-base-product-stock.dispatch ─► sync-base-product-stock.batch ──┐
                                                                            │
       import-competitor-products.dispatch ─► .drogal / .drogasil / .michelassi
                                                                ▼
       import-competitor-stock.dispatch ─► .drogal / .drogasil ──┘
                                                                ▼
                                        calc-base-product-metrics.dispatch ─► .batch
                                                                ▼
                                  update-base-product-properties.dispatch ─► .batch  (terminal)
```

All chain-boundary successors (last-batch, empty-dispatch) flow through
`core.pipeline_outbox` → OutboxPublisher → AMQP. Per-batch publishes
from dispatchers go direct.

## Triggering a run

**Cron** (production): `DailyPipelineCron` fires at 00:00 UTC and
publishes `pipeline.start` for every active tenant. Lives on the
API node only (`WORKER_MODE !== '1'` guard).

**Manual** (admin endpoint, plan 06):
```
POST /admin/tenants/:slug/pipeline:start
```
Returns `{ pipelineRunId }`.

**Manual** (REPL, when admin endpoint isn't available):
```bash
cat <<'EOF' > /tmp/trigger.ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PipelinePublisher } from './src/queue/pipeline-publisher.service';
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule);
  const runId = await app.get(PipelinePublisher).publishStart('acme', { reason: 'manual' });
  console.log('runId =', runId);
  await app.close();
})();
EOF
ts-node /tmp/trigger.ts
```

## "Is the run done?" — single query

```sql
SELECT step, batch_seq, status, attempt,
       batches_planned, batches_done,
       started_at, finished_at, error
FROM core.pipeline_run
WHERE pipeline_run_id = '<runId>'
ORDER BY started_at;
```

Healthy completion:
- One dispatch row per batched step with `status='completed'`,
  `batches_done = batches_planned`.
- N batch rows per batched step with `status='completed'`.
- Single-shot step (`sync-offer-books-info`) gets one `batch_seq=0` row.
- Two `branch.stock-a` + `branch.stock-b` rows (join markers).

## "It's stuck" — diagnosis tree

### 1. Dispatch row stuck at `status='running'`

```sql
SELECT step, batches_planned, batches_done, started_at,
       now() - started_at AS age
FROM core.pipeline_run
WHERE pipeline_run_id = '<runId>'
  AND batch_seq = 0 AND status = 'running'
ORDER BY started_at;
```

Possible causes:
- **Dispatcher crashed mid-publish**: `batches_planned` is set but
  some batches never reached the broker. Retry kicks in eventually
  (`startOrRestartDispatch` re-emits everything). If retries are
  exhausted, the row will go `failed` — check the `error` column.
- **Worker has no consumer for this step**: check
  `pipeline-steps.module.ts` CONSUMERS list + AMQP management UI for
  queue consumer count.

### 2. Counter stuck below planned (`batches_done < batches_planned`)

```sql
SELECT step,
       batches_done || ' / ' || batches_planned AS progress
FROM core.pipeline_run
WHERE pipeline_run_id = '<runId>' AND batch_seq = 0;
```

Possible causes:
- **Batch messages still in-flight on the broker**: check AMQP
  management UI for queue depth.
- **Worker crashed mid-handle**: D1 atomic CTE makes this safe —
  redelivery re-runs handle and bumps the counter. If the broker
  isn't redelivering, check that the channel ACK mode is set
  correctly (it should be auto ACK on success via @golevelup default).
- **Batch went to DLQ**: see the DLQ section below.

### 3. CALC never fires after both stock branches finished

The 2-branch join lives in `pipeline_run` as
`branch.stock-a` / `branch.stock-b` rows. CALC fires when both are
present with `status='completed'`.

```sql
SELECT step, status FROM core.pipeline_run
WHERE pipeline_run_id = '<runId>'
  AND step IN ('branch.stock-a', 'branch.stock-b');
```

If only one branch row exists but both dispatch rows show
`done=planned`, you hit the documented rare crash window between
the tenant-tx commit and `PipelineJoinService.markBranchComplete`
(see `plans/notes/fan-in-atomicity.md`).

**Manual recovery**:
```sql
INSERT INTO core.pipeline_run
  (pipeline_run_id, tenant_id, step, status, attempt,
   batch_seq, started_at, finished_at)
VALUES
  ('<runId>', '<tenantId>', 'branch.stock-b', 'completed',
   1, 0, now(), now());
```
Then manually publish CALC:
```bash
node -e "
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('./dist/app.module');
const {PipelinePublisher}=require('./dist/queue/pipeline-publisher.service');
const {PipelineStep}=require('./dist/database/enums/pipeline-step.enum');
const {dispatchStep}=require('./dist/queue/constants');
const {newPipelineMessage}=require('./dist/queue/types');
(async()=>{
  const app=await NestFactory.createApplicationContext(AppModule);
  await app.get(PipelinePublisher).publishStep(newPipelineMessage({
    pipelineRunId:'<runId>',tenantId:'<tenantSlug>',
    step:PipelineStep.CALC_BASE_PRODUCT_METRICS,
    queue:dispatchStep(PipelineStep.CALC_BASE_PRODUCT_METRICS),
    payload:{},
  }));
  await app.close();
})();
"
```

## Outbox monitoring

```sql
SELECT COUNT(*) AS pending,
       MIN(created_at) AS oldest_pending,
       MAX(attempts) AS max_attempts
FROM core.pipeline_outbox
WHERE published_at IS NULL;
```

Healthy: `pending = 0` most of the time, occasional 1–10 during
chain transitions, drained within 5 seconds (`OutboxPublisher` tick).

`claimed_at` is the lease marker. A row claimed in the last
`CLAIM_GRACE_MS` (60s, `src/queue/outbox.repository.ts`) is excluded
from re-claim, so two concurrent publisher ticks can't double-publish
the same row. A crashed publisher's row becomes claimable again after
the grace expires — at-least-once delivery, downstream consumers are
idempotent.

Stuck:
- **`pending` climbing** → AMQP connection issue or publisher cron
  not running. Check worker logs for `OutboxPublisher` errors.
- **`max_attempts > 10`** on a row → broker has been rejecting that
  publish persistently. Inspect:
  ```sql
  SELECT id, routing_key, attempts, message
  FROM core.pipeline_outbox
  WHERE attempts > 10 AND published_at IS NULL
  ORDER BY attempts DESC;
  ```
  Common cause: routing key references a queue that doesn't exist.
  After fixing the binding, the row drains on the next tick.
- **Row `claimed_at` set, never published** → publisher crashed mid-publish.
  Wait `CLAIM_GRACE_MS` (60s); next tick reclaims and retries. If a row
  is stuck claimed for hours, the worker is wedged — check process state.

## DLQ debugging

> ⚠️ **Known gap (dlq-v2-coverage):** the admin DLQ API
> (`GET/POST /admin/dlq/:step`) only works for `sync-offer-books-info`.
> It validates `:step` against `STEP_QUEUES` (v1) and reads `<step>.dlq`,
> which doesn't exist for the v2 batched/per-origin steps. For every
> other step, use the AMQP management UI or the node snippet below
> against the real DLQ name. Tracked by `TODO(dlq-v2-coverage)` in
> `src/admin/services/dlq.service.ts`.

Per-queue DLQs follow `<queue>.dlq`. E.g.:
- `sync-base-product.batch.dlq`
- `import-competitor-products.DROGAL.dlq`

Read messages without consuming via AMQP management UI ("Get
messages" → "Ack mode: Reject requeue=false"). Or programmatically:

```bash
node -e "
const {NestFactory}=require('@nestjs/core');
const {AppModule}=require('./dist/app.module');
const {AmqpConnection}=require('@golevelup/nestjs-rabbitmq');
(async()=>{
  const app=await NestFactory.createApplicationContext(AppModule);
  const amqp=app.get(AmqpConnection);
  const msg=await amqp.channel.get('sync-base-product.batch.dlq',{noAck:false});
  if(msg)console.log(JSON.parse(msg.content.toString()));
  await app.close();
})();
"
```

Once you've identified the bad message:
- Fix the root cause in code.
- Republish manually with `attempt: 1`:
  ```js
  await amqp.publish(EXCHANGE_NAME, `${tenantId}.${routingSegment}`, msg, {persistent:true});
  ```
- Ack the DLQ message to remove it.

## Useful one-liners

**Active runs across all tenants:**
```sql
SELECT pipeline_run_id, tenant_id,
       count(*) FILTER (WHERE status='completed') AS done,
       count(*) FILTER (WHERE status='running') AS running,
       count(*) FILTER (WHERE status='failed') AS failed
FROM core.pipeline_run
WHERE started_at > now() - interval '1 day'
GROUP BY pipeline_run_id, tenant_id;
```

**Per-step P50/P95 duration (last 7 days):**
```sql
SELECT step,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY finished_at - started_at) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY finished_at - started_at) AS p95
FROM core.pipeline_run
WHERE batch_seq = 0
  AND status = 'completed'
  AND finished_at > now() - interval '7 days'
GROUP BY step
ORDER BY p95 DESC;
```

**Cleanup: archive pipeline_run rows older than N days** (manual):
```sql
DELETE FROM core.pipeline_run WHERE started_at < now() - interval '30 days';
DELETE FROM core.pipeline_outbox WHERE published_at < now() - interval '30 days';
```

## Anti-bot incidents (Phase C scrapers)

Symptom: a per-origin queue's batches all fail with HTTP errors
(429, 403, captcha redirect). Sequence:

1. Look at `core.pipeline_run` for `step='import-competitor-products'`
   with attempt > 1 — if all fail, the origin is rejecting us.
2. Pause the origin via tenant config:
   ```sql
   SET search_path TO tenant_<slug>;
   UPDATE tenant_competitor_origin SET enabled=false WHERE origin='DROGAL';
   ```
3. Wait an hour, try a single EAN scrape manually to confirm the
   block has lifted (see `docs/pipeline/import-competitor-e2e.md`).
4. Re-enable.

The pipeline keeps running for the other origins — disabling one
origin doesn't block the others' batches.
