# Fly.io Queue Broker — Operator Runbook

Self-hosted RabbitMQ on Fly (`farmacore-broker`). Queue topology is declared
by `QueueModule` at api/worker boot — the broker ships empty except for
users/vhost defaults.

See also: [`11-fly-queue-broker.md`](../plans/11-fly-queue-broker.md),
[`queue-broker-cost-analysis.md`](../queue-broker-cost-analysis.md).

---

## Management UI

| | |
|---|---|
| **URL** | https://farmacore-broker.fly.dev/ |
| **User** | `farmacore` (or value of `RABBITMQ_DEFAULT_USER`) |
| **Pass** | password manager (same as `RABBITMQ_DEFAULT_PASS` / api/worker `AMQP_MGMT_PASS`) |

**Alternative (no public URL):**

```bash
fly proxy 15673:15672 -a farmacore-broker
# → http://localhost:15673/
```

---

## First deploy

```bash
fly apps create farmacore-broker --org <your-org>
fly volumes create rabbitmq_data --region gru --size 10 --app farmacore-broker

BROKER_PASS=$(openssl rand -base64 32)

fly secrets set --app farmacore-broker \
  RABBITMQ_DEFAULT_USER=farmacore \
  RABBITMQ_DEFAULT_PASS="$BROKER_PASS"

fly deploy --config fly.broker.toml --app farmacore-broker --remote-only
```

Open the management UI → Overview should show a healthy node, 0 queues until
api/worker connect.

---

## Wire api + worker

Internal AMQP URL (no TLS on Fly private network):

```
AMQP_URL=amqp://farmacore:<BROKER_PASS>@farmacore-broker.internal:5672/
```

Set on both apps:

```bash
fly secrets set --config fly.api.toml --app farmacore-api \
  AMQP_URL="amqp://farmacore:${BROKER_PASS}@farmacore-broker.internal:5672/" \
  AMQP_MGMT_URL="https://farmacore-broker.fly.dev/api" \
  AMQP_MGMT_USER=farmacore \
  AMQP_MGMT_PASS="${BROKER_PASS}"

fly secrets set --config fly.worker.toml --app farmacore-worker \
  AMQP_URL="amqp://farmacore:${BROKER_PASS}@farmacore-broker.internal:5672/" \
  AMQP_MGMT_URL="https://farmacore-broker.fly.dev/api" \
  AMQP_MGMT_USER=farmacore \
  AMQP_MGMT_PASS="${BROKER_PASS}"
```

Deploy api then worker:

```bash
fly deploy --config fly.api.toml --app farmacore-api --remote-only
fly deploy --config fly.worker.toml --app farmacore-worker --remote-only
```

Remove obsolete `CLOUDAMQP_API_*` secrets after cutover (optional).

---

## Health validation checklist

Run daily or after deploy:

1. **Overview** — no red alarms; memory < 60% watermark; disk free > 2 GB.
2. **Connections** — exactly 2 stable connections (api, worker); no orphaned channels growing unbounded.
3. **Queues** — all non-DLQ depths return to ~0 after nightly pipeline; DLQ depths = 0.
4. **Consumers** — each step queue shows ≥1 consumer (worker running).
5. **Oldest message** — OTel gauge `pipeline.queue.oldest_age_seconds` < 3600 on non-scrape queues during the day (see [`dashboards.md`](../observability/dashboards.md)).
6. **App `/health`** — `rabbitmq.connected: true` on API.

### Post-cutover expectations

| Check | Expected |
|---|---|
| Connections | 2 (api + worker), multiple channels |
| Exchanges | `pipeline.production`, `pipeline.production.dlx` |
| Queues | ~34 (step + DLQ + start + migrate) |
| Consumers | >0 on each step queue the worker subscribes to |

---

## Message inspection

Management UI → **Queues** → pick queue (e.g. `import-competitor-products.drogal.dlq`) → **Get messages** → count 1, requeue Yes → inspect JSON (`pipelineRunId`, `tenantId`, `payload`).

For replay at scale: `POST /admin/dlq/:queue/replay`.

---

## Configuration changes

| Change | Where | Redeploy |
|---|---|---|
| VM RAM/CPU | `fly.broker.toml` `[[vm]]` | `fly deploy --config fly.broker.toml` |
| Memory/disk watermark | `docker/rabbitmq/rabbitmq.conf` | broker deploy |
| Queue topology / prefetch | `src/queue/constants.ts`, `queue.module.ts` | api + worker (not broker) |
| Broker password | `fly secrets set` on broker + api + worker | all three apps |
| Volume size | `fly volumes extend` | broker restart |
| AMQP heartbeat / scrape prefetch | `rabbitmq.conf` + `constants.ts` `AMQP_HEARTBEAT_*` / `STEP_PREFETCH` | broker + api/worker deploy |

---

## Backup / restore

```bash
# Snapshot (Fly)
fly volumes snapshots create <volume-id> -a farmacore-broker

# Optional: export definitions (users/vhosts only — queues are app-declared)
curl -u farmacore:$PASS https://farmacore-broker.fly.dev/api/definitions -o backup-definitions.json
```

Restore: create volume from snapshot → redeploy broker → redeploy api/worker (re-declares topology).

---

## Cutover from CloudAMQP

1. Deploy broker (above) without switching apps.
2. Drain CloudAMQP — wait until all queues empty (or accept in-flight loss during a maintenance window).
3. Switch secrets on api + worker during low traffic.
4. Redeploy api + worker — `QueueModule` re-declares full topology on the new broker.
5. Run full pipeline E2E per `docs/pipeline/*-e2e.md`.
6. Delete CloudAMQP instance after 48 h stable (see [`teardown.md`](./teardown.md)).

---

## Local dev

Compose mounts `docker/rabbitmq/rabbitmq.dev.conf` (guest allowed). Management UI: `http://localhost:15673` (`guest/guest`). AMQP: `amqp://guest:guest@localhost:5673`.

Prod broker disables guest and uses strong credentials via Fly secrets.
