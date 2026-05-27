# sync-base-product — end-to-end validation

Quick recipe to exercise the v2 dispatcher/batch port against a real
A7Pharma ERP. The unit specs cover the helpers; this is the proof that
the full chain (RMQ -> dispatcher -> N batches -> shared_catalog +
tenant writes) works end-to-end with production-shape data.

## Prerequisites

- Local stack up: `docker compose up -d postgres rabbitmq`
- App + tenant schemas migrated:
  ```bash
  npm run migration:run:app
  npm run tenant:create acme || true
  npm run migration:tenant acme
  ```
- A tenant row in `core.integration_database_connection` pointing at a
  reachable A7Pharma Postgres (origin = `a7pharma`). Encrypt the
  password via the seed script or admin endpoint introduced in plan 03.

## Running the chain

Two shells:

```bash
# Shell 1 — API
npm run start:dev

# Shell 2 — worker
npm run build && WORKER_MODE=1 node dist/main.worker.js
```

Trigger a run for the tenant (e.g. via REPL or the admin endpoint from
plan 06):

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

## Verifying

In psql, after the run settles:

```sql
SELECT step, batch_seq, status, batches_planned, batches_done
FROM core.pipeline_run
WHERE pipeline_run_id = '<paste runId>'
ORDER BY step, batch_seq;
```

Expected for sync-base-product:
- one row with `step='sync-base-product'`, `batch_seq=0`,
  `status='completed'`, `batches_planned=N`, `batches_done=N` (the
  dispatch row).
- N rows with `step='sync-base-product'`, `batch_seq=1..N`,
  `status='completed'`.

Then check the writes:

```sql
SET search_path TO tenant_acme, shared_catalog, public;

SELECT COUNT(*) FROM shared_catalog.base_product;
SELECT COUNT(*) FROM tenant_product;
SELECT COUNT(*) FROM classification;
SELECT COUNT(*) FROM offer_book;

-- Spot-check a known EAN
SELECT bp.ean, bp.description, bp.generic, bp.active_ingredient,
       tp.name, tp.price, tp.cost, tp.supplier, tp.deals
FROM shared_catalog.base_product bp
JOIN tenant_product tp USING (ean)
WHERE bp.ean = <known ean>;
```

## Common surprises

- **`tenant_product.classification_id` empty**: the ERP product's
  `classificacao` row may not have a `caminho` set, or no
  `classificacao.principal = true` row exists. Inspect
  `classificacao_produto` rows for the produtoid; legacy fell back to
  no classification in this case and so does the new step.
- **`offer_book` rows for EANs that no longer exist in the ERP**:
  expected. The dispatcher does not call `deleteAll()` (would race
  with restart + idempotent batches); stale rows accumulate. A
  follow-up cleanup pass is tracked under "Open questions" in
  notes/pipeline-throughput.md.
- **A batch goes to DLQ**: check the worker logs for the underlying
  error. Most likely culprits: integration DataSource connection
  refused (verify credentials), a schema column mismatch, or an
  unexpected null on a non-null produto field. Replay the batch by
  manually re-publishing the message with the same payload + a fresh
  attempt count.
