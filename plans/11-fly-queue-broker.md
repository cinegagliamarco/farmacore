# 11 — Fly.io Queue Broker Implementation Plan

> **For agentic workers:** implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CloudAMQP with a **self-hosted RabbitMQ broker** on Fly.io (`gru`), co-located with `farmacore-api` and `farmacore-worker`. Configuration lives in version-controlled files; the **RabbitMQ Management UI** (user/password) gives operators everything needed to validate broker health, queue depth, consumers, and individual messages.

**Architecture:** Third Fly app `farmacore-broker` runs the same `rabbitmq:3.13-management-alpine` image used in local `docker-compose`. AMQP (`5672`) is reachable only on the Fly private network (`farmacore-broker.internal`). The management plugin (`15672`) is exposed over **HTTPS** with RabbitMQ-native login. App topology (exchanges, queues, DLQs) continues to be declared at boot by `QueueModule` — the broker ships empty except for users/vhost defaults.

**Tech stack:** RabbitMQ 3.13 + management plugin, Fly.io Machines + Volumes, existing `QueueMetricsPoller` + OTel dashboards.

**Reference:** `docs/queue-broker-cost-analysis.md`, `docker-compose.yml`, `plans/04-queue-infrastructure.md`, `docs/observability/dashboards.md`.

---

## Design principles

1. **Config in git, secrets out of git** — broker tuning (`rabbitmq.conf`, VM size) is committed; credentials are Fly secrets.
2. **No duplicate topology** — do not maintain a `definitions.json` for queues. `src/queue/constants.ts` + `QueueModule` remain the single source of truth (already true today).
3. **Same API surface for apps** — `AMQP_URL` + management API env vars; optional rename to broker-agnostic names (Task 3).
4. **Management UI = ops console** — depth, rates, consumers, connections, message peek, node memory/disk. No custom dashboard required for day-to-day validation (OTel remains for alerting).

---

## Interfaces exposed

| Surface | Access | Purpose |
|---|---|---|
| `amqp://farmacore-broker.internal:5672` | Private (api + worker only) | Pipeline publish/consume |
| `https://farmacore-broker.fly.dev/` | Public HTTPS + **RabbitMQ user/pass** | Management UI |
| `https://farmacore-broker.fly.dev/api/*` | Same credentials (Basic auth) | Used by `QueueMetricsPoller` |
| `GET /api/healthchecks/node` | Basic auth | Fly machine health check |

**Management UI screens operators use:**

| Tab | Validates |
|---|---|
| **Overview** | Node uptime, message rates (publish/deliver/ack), global ready/unacked counts, alarm status |
| **Connections** | API + worker connected; channels open; client properties |
| **Queues** | Per-queue depth, consumers, publish/deliver rates; filter `*.dlq` for failures |
| **Queue → Get messages** | Peek payload JSON without consuming (debugging) |
| **Exchanges** | `pipeline.production` + `pipeline.production.dlx` bindings |
| **Admin → Users** | Credential rotation |

---

## File structure

```
docker/rabbitmq/
├─ Dockerfile.broker              # extends official image, bakes config
├─ rabbitmq.conf                  # memory/disk limits, disable guest
└─ enabled_plugins                # [rabbitmq_management].

fly.broker.toml                   # Fly app: VM, volume, services, checks

docs/provisioning/
├─ fly-queue-broker.md            # operator runbook (deploy, access, rotate, restore)
└─ first-deploy.md                # (amend) broker section replaces CloudAMQP §3

.env.example                      # AMQP_MGMT_* aliases documented
src/config/
├─ app-config.service.ts          # amqpMgmt getter with CLOUDAMQP_* fallback
└─ env.validation.ts
src/observability/queue-metrics.poller.ts   # read amqpMgmt instead of cloudamqp

.github/workflows/deploy.yml      # optional: deploy-broker job (manual / workflow_dispatch only)
```

---

## Task 1: Broker config files (easy to change)

**Files:** `docker/rabbitmq/rabbitmq.conf`, `docker/rabbitmq/enabled_plugins`, `docker/rabbitmq/Dockerfile.broker`

- [x] **Step 1: `enabled_plugins`**

```
[rabbitmq_management].
```

- [x] **Step 2: `rabbitmq.conf`** — tune here when load changes; no image rebuild beyond redeploy.

```ini
# Disable default guest user in production (credentials come from Fly secrets).
loopback_users.guest = false

# Persist messages to disk (matches app's persistent: true publishes).
vm_memory_high_watermark.relative = 0.6

# Stop publishers when free disk drops below 2 GB (adjust if volume size changes).
disk_free_limit.absolute = 2GB

# Heartbeat — detect dead connections from api/worker after Fly restarts.
heartbeat = 60

# Management plugin listens on all interfaces inside the VM (Fly routes HTTPS).
management.tcp.port = 15672

# Default vhost
default_vhost = /
default_user = farmacore
# default_pass set via RABBITMQ_DEFAULT_PASS secret at runtime
```

- [x] **Step 3: `Dockerfile.broker`**

```dockerfile
FROM rabbitmq:3.13-management-alpine
COPY docker/rabbitmq/rabbitmq.conf /etc/rabbitmq/rabbitmq.conf
COPY docker/rabbitmq/enabled_plugins /etc/rabbitmq/enabled_plugins
# Data dir is mounted at /var/lib/rabbitmq via Fly volume
```

- [ ] **Step 4: Commit**

---

## Task 2: Fly app manifest

**File:** `fly.broker.toml`

- [x] **Step 1: Create manifest**

```toml
# farmacore-broker — RabbitMQ + management UI. AMQP is private (.internal only).
# Management UI: https://farmacore-broker.fly.dev/ (RabbitMQ user/password).

app = "farmacore-broker"
primary_region = "gru"

[build]
  dockerfile = "docker/rabbitmq/Dockerfile.broker"

[env]
  # RABBITMQ_DEFAULT_USER / RABBITMQ_DEFAULT_PASS come from Fly secrets.

[mounts]
  source = "rabbitmq_data"
  destination = "/var/lib/rabbitmq"

# Management UI — public HTTPS. AMQP (5672) is NOT listed here; reachable via .internal only.
[[services]]
  internal_port = 15672
  protocol = "tcp"
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[services.ports]]
    handlers = ["http"]
    port = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  # Management plugin exposes /api/healthchecks/node (requires auth — use tcp or skip http check).
  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "30s"

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048
```

> **Sizing knob:** change `[[vm]]` here only. Start at **shared-cpu-2x / 2 GB** (~$18/mo in `gru` per cost analysis). Bump to 4 GB if memory alarms appear during scrape peaks.

- [ ] **Step 2: Create app + volume**

```bash
fly apps create farmacore-broker --org <your-org>
fly volumes create rabbitmq_data --region gru --size 10 --app farmacore-broker
```

- [ ] **Step 3: Set secrets**

```bash
# Generate once; store in password manager.
BROKER_PASS=$(openssl rand -base64 32)

fly secrets set --app farmacore-broker \
  RABBITMQ_DEFAULT_USER=farmacore \
  RABBITMQ_DEFAULT_PASS="$BROKER_PASS"
```

- [ ] **Step 4: First deploy**

```bash
fly deploy --config fly.broker.toml --app farmacore-broker --remote-only
```

- [ ] **Step 5: Verify management UI**

Open `https://farmacore-broker.fly.dev/` → login with `farmacore` / `$BROKER_PASS`. Overview should show a healthy node, 0 queues (until api/worker connect).

- [ ] **Step 6: Commit**

```bash
git add fly.broker.toml
git commit -m "feat(broker): add Fly manifest for farmacore-broker"
```

---

## Task 3: Broker-agnostic management env vars

Today `QueueMetricsPoller` reads `CLOUDAMQP_API_*`. Rename to generic names with backward-compatible fallback so switching hosts is a secret change, not a code fork.

**Files:** `src/config/env.validation.ts`, `src/config/app-config.service.ts`, `src/observability/queue-metrics.poller.ts`, `.env.example`, docs

- [x] **Step 1: Add env vars** (keep old names as optional aliases)

| New (preferred) | Old (fallback) | Example (prod) |
|---|---|---|
| `AMQP_MGMT_URL` | `CLOUDAMQP_API_URL` | `https://farmacore-broker.fly.dev/api` |
| `AMQP_MGMT_USER` | `CLOUDAMQP_API_USER` | `farmacore` |
| `AMQP_MGMT_PASS` | `CLOUDAMQP_API_PASS` | same as broker secret |

- [x] **Step 2: `AppConfigService.amqpMgmt()`** — returns first non-empty of new/old keys.

- [x] **Step 3: Update `QueueMetricsPoller`** to use `config.amqpMgmt`.

- [x] **Step 4: Update `.env.example` and smoke doc** (`docs/observability/local-smoke.md`):

```bash
# Local (docker-compose management on :15673)
AMQP_MGMT_URL=http://localhost:15673/api
AMQP_MGMT_USER=guest
AMQP_MGMT_PASS=guest
```

- [x] **Step 5: Unit test** — poller no-ops when all six vars empty; works with new names; works with old names alone.

- [ ] **Step 6: Commit**

```bash
git commit -m "refactor(obs): broker-agnostic AMQP_MGMT_* env vars with CloudAMQP fallback"
```

---

## Task 4: Wire api + worker to the Fly broker

**Files:** Fly secrets (no git), `docs/provisioning/fly-queue-broker.md`

- [ ] **Step 1: Build internal AMQP URL**

```
AMQP_URL=amqp://farmacore:<BROKER_PASS>@farmacore-broker.internal:5672/
```

No TLS on internal Fly network is acceptable (traffic stays inside the private network). If TLS is required later, switch to `amqps` with server-side certs — out of scope for v1.

- [ ] **Step 2: Update secrets on both apps**

```bash
fly secrets set --config fly.api.toml --app farmacore-api \
  AMQP_URL="amqp://farmacore:${BROKER_PASS}@farmacore-broker.internal:5672/" \
  AMQP_MGMT_URL="https://farmacore-broker.fly.dev/api" \
  AMQP_MGMT_USER=farmacore \
  AMQP_MGMT_PASS="${BROKER_PASS}"

# Mirror identically on farmacore-worker
fly secrets set --config fly.worker.toml --app farmacore-worker \
  AMQP_URL="..." \
  AMQP_MGMT_URL="..." \
  AMQP_MGMT_USER=farmacore \
  AMQP_MGMT_PASS="${BROKER_PASS}"
```

Remove obsolete `CLOUDAMQP_API_*` secrets after cutover (optional cleanup).

- [ ] **Step 3: Deploy api then worker** (existing order preserves migration safety)

```bash
fly deploy --config fly.api.toml --app farmacore-api --remote-only
fly deploy --config fly.worker.toml --app farmacore-worker --remote-only
```

- [ ] **Step 4: Validate in management UI**

| Check | Expected |
|---|---|
| Connections | 2 (api + worker), multiple channels |
| Exchanges | `pipeline.production`, `pipeline.production.dlx` |
| Queues | ~34 (step + DLQ + start + migrate) |
| Consumers | >0 on each step queue the worker subscribes to |
| Overview → Message rates | Publish/deliver activity during a pipeline run |

- [ ] **Step 5: Trigger test pipeline**

```bash
# After admin login
curl -X POST "https://farmacore-api.fly.dev/admin/tenants/<slug>/pipeline/start" \
  -H "Authorization: Bearer <admin-jwt>"
```

Watch queue depths rise and drain; confirm no messages stuck in `*.dlq`.

---

## Task 5: Operator runbook + monitoring checklist

**File:** `docs/provisioning/fly-queue-broker.md`

- [x] **Step 1: Document access**

```markdown
## Management UI
URL: https://farmacore-broker.fly.dev/
User: farmacore (or value of RABBITMQ_DEFAULT_USER)
Pass: <password manager>

Alternative (no public URL): fly proxy 15673:15672 -a farmacore-broker
→ http://localhost:15673/
```

- [x] **Step 2: Health validation checklist** (daily / after deploy)

1. **Overview** — no red alarms; memory < 60% watermark; disk free > 2 GB.
2. **Connections** — exactly 2 stable connections (api, worker); 0 orphaned channels growing unbounded.
3. **Queues** — all non-DLQ depths return to ~0 after nightly pipeline; DLQ depths = 0.
4. **Consumers** — each step queue shows ≥1 consumer (worker running).
5. **Oldest message** — OTel gauge `pipeline.queue.oldest_age_seconds` < 3600 on non-scrape queues during the day (see dashboards doc).
6. **App `/health`** — `rabbitmq.connected: true` on API.

- [x] **Step 3: Message inspection recipe**

Management UI → **Queues** → pick queue (e.g. `import-competitor-products.drogal.dlq`) → **Get messages** → set count 1, requeue Yes → inspect JSON payload (`pipelineRunId`, `tenantId`, `payload`).

For replay at scale, use existing admin API: `POST /admin/dlq/:queue/replay`.

- [x] **Step 4: Configuration change recipes**

| Change | Where | Redeploy |
|---|---|---|
| VM RAM/CPU | `fly.broker.toml` `[[vm]]` | `fly deploy --config fly.broker.toml` |
| Memory/disk watermark | `docker/rabbitmq/rabbitmq.conf` | broker deploy |
| Queue topology / prefetch | `src/queue/constants.ts`, `queue.module.ts` | api + worker deploy (not broker) |
| Broker password | `fly secrets set` on broker + api + worker | all three apps |
| Volume size | `fly volumes extend` | broker restart |

- [x] **Step 5: Backup / restore**

```bash
# Snapshot (Fly)
fly volumes snapshots create <volume-id> -a farmacore-broker

# Optional: export definitions (users/vhosts only — queues are app-declared)
curl -u farmacore:$PASS https://farmacore-broker.fly.dev/api/definitions -o backup-definitions.json
```

Restore: create volume from snapshot → redeploy broker → redeploy api/worker (re-declares topology).

- [x] **Step 6: Commit runbook**

---

## Task 6: Local dev parity

**Files:** `docker-compose.yml` (optional hardening), `docs/observability/local-smoke.md`

- [x] **Step 1:** Mount the same `docker/rabbitmq/rabbitmq.conf` in compose (without `loopback_users.guest = false` for dev, or use a `rabbitmq.dev.conf` override).

- [x] **Step 2:** Document that local management UI stays `http://localhost:15673` (`guest/guest`) while prod uses the Fly URL + strong password.

- [ ] **Step 3:** Confirm `QueueMetricsPoller` smoke with `AMQP_MGMT_URL=http://localhost:15673/api`.

---

## Task 7: CI / deploy workflow (optional, low churn)

Broker changes rarely. Avoid blocking every app deploy on broker health.

- [x] **Step 1: Add manual workflow** `.github/workflows/deploy-broker.yml`:

```yaml
name: Deploy Broker
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.broker.toml --remote-only --app farmacore-broker
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

Do **not** add broker to the main `deploy.yml` chain unless the team wants it — api/worker deploys should not restart RabbitMQ on every push.

---

## Task 8: Cutover from CloudAMQP

- [ ] **Step 1: Deploy broker** (Tasks 1–2) without switching apps.
- [ ] **Step 2: Drain CloudAMQP** — wait until all queues empty (or accept loss of in-flight work during a maintenance window).
- [ ] **Step 3: Switch secrets** (Task 4) during low traffic.
- [ ] **Step 4: Redeploy api + worker** — `QueueModule` re-declares full topology on the new broker.
- [ ] **Step 5: Run full pipeline E2E** per `docs/pipeline/*-e2e.md`.
- [ ] **Step 6: Delete CloudAMQP instance** after 48 h stable (see `docs/provisioning/teardown.md`).

---

## Task 9: Acceptance criteria

- [ ] `https://farmacore-broker.fly.dev/` loads; **guest login rejected**; `farmacore` user works.
- [ ] AMQP port **not** reachable from the public internet (only `.internal` from api/worker machines).
- [ ] Full nightly pipeline completes; management UI shows consumers and draining queues.
- [ ] `QueueMetricsPoller` emits `pipeline.queue.depth` and `pipeline.queue.oldest_age_seconds` in prod.
- [ ] `/health` reports `rabbitmq.connected: true`.
- [ ] DLQ admin API (`GET /admin/dlq`, replay) works against Fly broker.
- [ ] Config change to `rabbitmq.conf` requires only broker redeploy; config change to queue topology requires only api/worker redeploy.
- [ ] Volume snapshot restore tested once in staging or documented dry-run.

---

## Cost estimate (broker app only)

| Resource | Spec | ~$/mo (`gru`) |
|---|---|---|
| Machine | shared-cpu-2x, 2 GB | $18 |
| Volume | 10 GB | $1.50 |
| **Total** | | **~$20** |

See `docs/queue-broker-cost-analysis.md` for tenant scaling comparison vs CloudAMQP.

---

## Out of scope (v1)

- RabbitMQ clustering / HA (accept single-node SPOF until ≥5 tenants or hard SLA).
- LavinMQ (stay on RabbitMQ — already used locally; full `amqplib` + management plugin parity).
- Custom React monitoring dashboard (management UI covers v1; OTel covers alerting).
- TLS on internal AMQP (Fly private network).

---

## Quick reference — env vars after cutover

| App | Variable | Value |
|---|---|---|
| broker | `RABBITMQ_DEFAULT_USER` | `farmacore` |
| broker | `RABBITMQ_DEFAULT_PASS` | secret |
| api + worker | `AMQP_URL` | `amqp://farmacore:…@farmacore-broker.internal:5672/` |
| api + worker | `AMQP_MGMT_URL` | `https://farmacore-broker.fly.dev/api` |
| api + worker | `AMQP_MGMT_USER` | `farmacore` |
| api + worker | `AMQP_MGMT_PASS` | same as broker |
