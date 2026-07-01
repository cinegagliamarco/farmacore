# Observability — Dashboards & Alerts

V1 ships production-only. Pick a vendor (Datadog / Grafana Cloud /
Better Stack), point `OTEL_EXPORTER_OTLP_ENDPOINT` at its OTLP/HTTP
collector, set `OTEL_EXPORTER_OTLP_HEADERS` for auth, and build the
panels below. The exporter is vendor-agnostic; the panel queries
below use PromQL-style notation — adapt to the vendor's query language.

## Service map

Auto-populated from OTel traces. Should show:

- `farmacore-api` → `farmacore-worker` (via RMQ; `amqplib`
  auto-instrumentation propagates trace context).
- `farmacore-api` → `postgres` (`pg` auto-instrumentation).
- `farmacore-worker` → `postgres` (tenant + shared_catalog writes)
  and `<tenant ERP>` (per-tenant DataSource — appears as a separate
  Postgres node tagged by the integration host).

## Pipeline dashboard

| Panel | Query (PromQL-style — adapt to vendor) |
|---|---|
| Queue depth per queue | `sum by (queue) (pipeline_queue_depth)` |
| Oldest message age (sec) | `max by (queue) (pipeline_queue_oldest_age_seconds)` |
| Success rate per step per tenant | from spans: `count(span_status='OK' && span_name=~'pipeline.*') / count(span_name=~'pipeline.*')` grouped by `tenant.id`, `pipeline.step` |
| p50/p99 step duration | duration histograms from the auto-instrumentation, grouped by `pipeline.step` |
| DLQ size per step | `sum by (queue) (pipeline_queue_depth{queue=~'.+\\.dlq'})` |
| Outbox pending | direct Postgres query (no metric yet): `SELECT count(*) FROM core.pipeline_outbox WHERE published_at IS NULL` |

## Alerts

| Alert | Threshold | Action |
|---|---|---|
| DLQ size > 0 for >5min | `pipeline_queue_depth{queue=~'.+\\.dlq'} > 0` for 5m | Page oncall |
| Queue depth > 1000 for >15min on a non-DLQ queue | as above | Page oncall |
| Worker restarts > 3 in 30min | service restart event | Slack |
| `/health` failing for >2min | HTTP 503 → both API and worker | Page oncall |
| Outbox pending > 100 for >5min | requires SQL alerting | Page oncall |
| Outbox row with `attempts > 10` | requires SQL alerting | Slack |

## Per-tenant filters

Every pipeline span carries `tenant.id`. Use it as the primary
dashboard variable. Every log entry made during an active span carries
`traceId` + `spanId` (stamped by `NestInternalLogger`) — click-through
from log entry to trace.

## Span attributes (canonical set)

| Attribute | Source | Notes |
|---|---|---|
| `tenant.id` | base pipeline consumers (from message) | Tenant slug |
| `pipeline.run_id` | message | UUID per cron run |
| `pipeline.step` | consumer class | One of the 7 active steps |
| `pipeline.attempt` | message | 1..MAX_ATTEMPTS |
| `pipeline.batch_seq` | message (batch consumers only) | 1..N per dispatch |
| `db.statement` | `pg` auto-instrumentation | redacted at the vendor — confirm before enabling |
| `messaging.system` | `amqplib` auto-instrumentation | `rabbitmq` |
| `messaging.destination.name` | `amqplib` | queue name |

## Queue metrics (`pipeline.queue.*`)

`QueueMetricsPoller` reads the RabbitMQ management API every 30s and
emits two observable gauges per queue:

- `pipeline.queue.depth` (number of messages, label `queue`)
- `pipeline.queue.oldest_age_seconds` (label `queue`)

Polling is a no-op when `AMQP_MGMT_URL` / `AMQP_MGMT_USER` /
`AMQP_MGMT_PASS` (or legacy `CLOUDAMQP_API_*`) aren't all set, so dev/local doesn't need
broker management credentials.
