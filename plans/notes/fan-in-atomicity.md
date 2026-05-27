# Fan-in atomicity — resolved in Phase D

> Original deadlock surfaced by `/codex review` after B2. Both
> failure windows are now closed. Phase D landed atomic CTE (D1) and
> outbox pattern (D2). The PipelineJoinService stays as-is — see
> "Why we kept PipelineJoinService" at the bottom.

## The original bug

`BatchPipelineConsumer.process()` ran three writes in sequence:

```ts
runs.complete(runId, step, batchSeq);     // window 1 ↓
runs.incrementBatchDone(runId, step);
publish(successors);                       // window 2 ↓
```

**Window 1**: crash between `complete()` and `incrementBatchDone()`.
The redelivered batch hits `start()`, sees the batch row already
`completed`, and exits — counter never gets the missing increment,
the step's `batches_done` stays short of `batches_planned`, and the
downstream step is never published. Pipeline deadlocks.

**Window 2**: counter advanced, `isLast=true`, but the successor
publish didn't reach the broker (network drop, container restart).
Redelivery short-circuits at `start()`, the last-batch path is never
re-entered, successor lost.

## D1 — atomic CTE (closes window 1)

`PipelineRunService.completeBatchAndIncrement(em, runId, step, batchSeq)`
merges complete + increment into one SQL CTE:

```sql
WITH batch_done AS (
  UPDATE core.pipeline_run
  SET status='completed', finished_at=now(), updated_at=now()
  WHERE pipeline_run_id=$1 AND step=$2 AND batch_seq=$3
    AND status='running'
  RETURNING 1
)
UPDATE core.pipeline_run
SET batches_done = batches_done + (SELECT count(*) FROM batch_done),
    updated_at=now()
WHERE pipeline_run_id=$1 AND step=$2 AND batch_seq=0
RETURNING batches_done, batches_planned;
```

`BatchPipelineConsumer.process()` calls it inside the tenant
transaction. Two consequences:
1. The batch row transition and the counter bump commit together —
   no orphan completion.
2. The CTE is idempotent: redelivery of an already-completed batch
   re-runs the CTE, the `WHERE status='running'` matches 0 rows,
   `count(*) = 0`, counter unchanged.

The e2e spec `test/pipeline-fan-in.e2e-spec.ts` exercises both
concurrent N-batch fan-in and the redelivery scenario.

## D2 — outbox (closes window 2)

New table `core.pipeline_outbox` (`id`, `pipeline_run_id`,
`tenant_id`, `routing_key`, `message`, `attempts`, `published_at`,
timestamps).

`BatchPipelineConsumer.process()` (and `DispatchPipelineConsumer`'s
empty-successors path) now WRITES successors to the outbox **inside
the same tenant tx** as `completeBatchAndIncrement`. The tx commit
makes the successor durable atomically with the counter bump.

`OutboxPublisher` runs every 5 seconds, claims a batch of unpublished
rows via `UPDATE...RETURNING WHERE published_at IS NULL FOR UPDATE
SKIP LOCKED`, publishes each via `AmqpConnection.publish`, and marks
`published_at` on success. If a publish throws, the row stays
unpublished and the next tick retries — `attempts` bumps each claim
so ops can alert on rows stuck high.

SKIP LOCKED makes it safe to run on every worker replica without
double-publish.

Trade-off chosen for dispatcher BATCHES (not empty-successors):
those still publish directly. Reasoning:
- A dispatcher's batches list can be 108k items (import-competitor-
  products). Outboxing all of them serializes 108k inserts into one
  tenant tx and gates them on a 100/tick publisher — pipeline
  latency tanks.
- Dispatcher restart is already safe: `startOrRestartDispatch` lets a
  crashed dispatcher re-emit the full batch list, and batch
  consumers' `start()` idempotency handles the duplicates.

So only the chain-boundary publishes (last-batch successors,
empty-dispatcher successors) flow through the outbox.

## Why we kept PipelineJoinService

The 2-branch join (`sync-base-product-stock` + `import-competitor-
stock` → CALC) uses `PipelineJoinService.markBranchComplete()`,
which inserts a `pipeline_run` row with step `branch.stock-a` /
`branch.stock-b` and counts how many such rows exist as completed.

The first reflex during Phase D planning was to replace it with
"each branch checks if the sibling step's dispatch row is done" —
no extra rows needed. But that approach has a real race INSIDE a
transaction:

- Branch A's tx: INSERT branch.stock-a (uncommitted) → SELECT count
  sees only own row (read committed isolation) → count = 1 → return
  'wait'.
- Branch B's tx (concurrent): INSERT branch.stock-b → SELECT count
  sees only own row → count = 1 → return 'wait'.
- Both commit. Neither fired CALC. ✗

The CURRENT join service works because each `save()` is auto-commit
(no explicit tx) — by the time the second branch's `count()` runs,
the first's row is already committed and visible. The LATER counter
always sees both rows and fires.

Moving the join inside the tenant tx (to make it atomic with D1+D2)
breaks this invariant. The fix would be SERIALIZABLE isolation or
explicit row-level locking on a shared counter — more complexity
than the join warrants.

So Phase D keeps `PipelineJoinService` and accepts that its calls
run OUTSIDE the tenant tx (via the injected Repository's auto-commit
connection). The cost: if the last-batch's tenant tx commits but the
process crashes before `markBranchComplete` runs, the join is one
branch short and CALC never fires.

That window is narrow (microseconds) and recoverable: ops can
inspect `pipeline_run` for runs where the dispatch row is `completed`
+ `batches_done == batches_planned` for BOTH stock branches but
`branch.stock-a` / `branch.stock-b` row count is < 2, and manually
insert the missing branch row to fire CALC. Documented as a known
edge case; not worth more code right now.
