# Fan-in atomicity — known issue, owned by Phase D

> Surfaced by `/codex review` after B2. Real bug, not in scope for B-phase
> ports. Fixing it inside Phase D when the join machinery is being
> redesigned anyway.

## The bug

`BatchPipelineConsumer.process()` runs three writes in sequence:

```ts
const outcome = await this.runs.start(runId, tenantId, step, attempt, batchSeq);
if (outcome === 'already-completed') return;
// ... handle()
await this.runs.complete(runId, step, batchSeq);          // ← (1)
const inc = await this.runs.incrementBatchDone(runId, step); // ← (2)
if (inc.isLast) for (const m of successors) await publisher.publishStep(m); // ← (3)
```

If the worker crashes (process kill, container restart, broker
connection drop) **between (1) and (2)**, the broker eventually
redelivers the batch message. The redelivered batch hits `start()`,
which sees the batch row as `completed` and returns early.
`incrementBatchDone()` is never called for this batch — `batches_done`
stays one short of `batches_planned`, the fan-in never trips
`isLast`, and the downstream step is never published. The pipeline
deadlocks.

A second window exists **between (2) and (3)**: counter advanced,
`isLast=true`, but the successor publish didn't reach the broker.
Redelivery skips early at `start()`, so the last-batch path is never
re-entered. Successor lost.

## Why deferring is OK for now

The whole join + fan-in machinery is the explicit subject of
**Phase D** in `plans/05-pipeline-steps.md`:

> Substituir join 2-branch pelo step-complete signaling

Phase D redesigns the counter-based fan-in. Fixing the atomicity
inside the current shape would be code we throw out in D. Better to
fold the fix into D's design from the start.

In the meantime, the bug is real but rare (window is two SQL
roundtrips wide). When it does fire, the run hangs and the operator
sees `batches_done < batches_planned` on the dispatch row + the
expected successor never published. Manual recovery: insert the
missing successor with the same `pipelineRunId` and `step` payload.

## Design for Phase D

Two complementary changes close both windows:

### 1. Atomic complete + increment (closes window 1)

Merge (1) and (2) into a single SQL CTE that only bumps the dispatch
counter when the batch row actually transitions `running -> completed`:

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

On redelivery after a crash mid-handle, the batch row is still
`running`, the CTE matches both updates, counter advances exactly
once. On redelivery after the CTE itself committed but the publish
crashed, the batch row is `completed`, CTE adds 0, counter stays
correct.

### 2. Successor publish via outbox (closes window 2)

Add `core.pipeline_outbox (id uuid, pipeline_run_id uuid, queue text,
routing_key text, message jsonb, created_at, published_at nullable,
attempts int default 0)`.

The last-batch path writes successors into `pipeline_outbox` in the
**same transaction** as the atomic CTE above. A scheduled publisher
(every few seconds) claims unpublished rows via
`UPDATE ... SET published_at=now() WHERE published_at IS NULL
RETURNING ...`, publishes via AMQP, and on broker confirm marks the
row done. Crash anywhere between the consumer commit and the publish
is recovered by the publisher's next sweep.

Outbox is also the natural place for the **dispatcher** to write its
successor seed (currently published outside any tx), which removes
the same atomicity hole from `DispatchPipelineConsumer`.

## Affected files (for D)

- `src/queue/pipeline-run.service.ts` — combine complete + increment.
- `src/queue/batch-pipeline.consumer.ts` — call the combined op; write
  successors to outbox instead of publishing inline.
- `src/queue/dispatch-pipeline.consumer.ts` — same outbox write for
  the dispatcher's seed publish.
- New: `src/queue/pipeline-outbox.*` — entity, repository, scheduled
  publisher service.
- Migration: `core.pipeline_outbox` table.
- Plan README amendment for plan 01 (new core table).
