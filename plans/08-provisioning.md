# 08 — Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: ⚙️ Artifacts committed; operator must execute the cloud steps.** All in-repo files are in place — `tsconfig.scripts.json`, `Dockerfile` (with `npm run build:scripts`), `fly.api.toml`, `fly.worker.toml`, `.github/workflows/deploy.yml`, `.github/workflows/pr-preview.yml`, and `docs/provisioning/{first-deploy,teardown}.md`. The cloud-side steps (creating R2 token, Neon project, CloudAMQP instance, Fly apps; setting secrets; first deploy; CI token) are documented in `docs/provisioning/first-deploy.md` and have not been run yet — they require operator credentials.

**Goal:** Bring up every cloud resource the app needs (Cloudflare R2, Neon, CloudAMQP, two Fly apps) and wire CI/CD via GitHub Actions. Output: a production environment that runs the same Docker image on `farmacore-api` (HTTP) and `farmacore-worker` (`WORKER_MODE=1`), backed by Neon + CloudAMQP + R2.

**Architecture:** **One Dockerfile, two Fly apps.** Both deploy from `Dockerfile` in the repo; the worker app's `fly.toml` sets `WORKER_MODE=1` as an env override. Each app has its own secrets but they're identical. Migrations run as a Fly `release_command` on the **API** app only — the release script applies app-level migrations and enqueues per-tenant migrations via RMQ (`scripts/enqueue-migrate-all.ts` from plan 05). Neon branches are created by GitHub Actions per PR (optional). Terraform is a follow-up — the plan ships CLI walkthroughs first.

**Tech Stack:** Fly.io (`flyctl`), Neon (`neonctl`), CloudAMQP CLI, Cloudflare dashboard, GitHub Actions. Terraform sketched in §7 (optional).

**Reference:** `arc/00-architecture.md` §4 (stack), §8 (cost), §9 (AWS comparison); `arc/05-provisioning-tutorial.md` in full.

---

## Interfaces Exposed

- **Fly apps:**
  - `farmacore-api` — public HTTP at `https://farmacore-api.fly.dev/health`, 1 instance min.
  - `farmacore-worker` — no public services; `WORKER_MODE=1`; 1 instance min.
- **Secrets** (set via `fly secrets set`, same on both apps): every key from `.env.example` (see plan 00).
- **Neon project:** `farmacore-prod`, database `app`, pooled + direct connection URLs.
- **CloudAMQP instance:** `farmacore-prod` (Tiger plan).
- **R2:** reused bucket from prototype; new scoped API token for the new app.
- **GitHub Actions:**
  - `.github/workflows/deploy.yml` — on push to `main`, run tests, deploy API, deploy worker.
  - `.github/workflows/pr-preview.yml` — (optional) on PR open/close, create/delete Neon branch.
- **Required GitHub secrets:** `FLY_API_TOKEN`, `NEON_API_KEY` (if PR-preview workflow used), `DOCKER_BUILDX_TOKEN` (if remote-only builds).

---

## File Structure

```
fly.api.toml
fly.worker.toml
.github/
└─ workflows/
   ├─ deploy.yml
   └─ pr-preview.yml          # optional
infra/                         # optional — Terraform port (§7)
├─ providers.tf
├─ variables.tf
├─ outputs.tf
├─ r2.tf
├─ neon.tf
├─ cloudamqp.tf
├─ fly.tf
└─ env/
   └─ prod.tfvars
docs/
└─ provisioning/
   ├─ first-deploy.md          # human runbook
   └─ teardown.md
```

---

### Task 1: Prerequisites

- [ ] **Step 1: Install CLIs locally**

```bash
brew install flyctl
npm install -g neonctl
brew install cloudamqp/cloudamqp/cloudamqp-cli   # or skip — dashboard works
```

- [ ] **Step 2: Authenticate**

```bash
fly auth login          # creates ~/.fly/config.yml
neonctl auth            # opens browser
cloudamqp login         # paste CLOUDAMQP_APIKEY when prompted
```

- [ ] **Step 3: Confirm accounts exist**

| Vendor | URL | Notes |
|---|---|---|
| Fly.io | https://fly.io | Needs a payment method even for small free tier |
| Neon | https://neon.tech | Launch ($19/mo) or Scale ($69/mo) plan |
| CloudAMQP | https://cloudamqp.com | Tiger plan ($19/mo) for v1 |
| Cloudflare | https://cloudflare.com | R2 needs a payment method |
| GitHub | https://github.com | For Actions secrets |

> Reminder from `arc/00 §8`: v1 ships **production-only**. Pre-prod testing uses Neon branches (free, copy-on-write) and a local Docker rabbitmq.

- [ ] **Step 4: No commit (env setup)**

---

### Task 2: Cloudflare R2 — reuse the existing bucket

Per `arc/05 §1`, the prototype's bucket is reused. We just issue a new scoped API token so the new app has independent credentials.

- [ ] **Step 1: Identify the existing bucket**

Open Cloudflare dashboard → **R2**. Note:
- **Bucket name** (e.g. `farmacore-assets`).
- **Account ID** (top of the R2 page). S3-compatible endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

- [ ] **Step 2: Create a scoped API token for the new app**

Dashboard → **Manage R2 API Tokens** → **Create API Token**:
- **Permission:** Object Read & Write.
- **Specify bucket:** the existing bucket only.
- **TTL:** 1 year (rotate annually).

Save **Access Key ID** and **Secret Access Key** — shown once.

- [ ] **Step 3: Decide on key prefix**

If the prototype is still writing to the same bucket, set `R2_KEY_PREFIX=farmacore-prod/` so the new app's keys are isolated. Otherwise leave empty.

- [ ] **Step 4: Smoke test**

```bash
export AWS_ACCESS_KEY_ID=<r2_access_key>
export AWS_SECRET_ACCESS_KEY=<r2_secret>
export AWS_DEFAULT_REGION=auto
ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com

aws s3 ls s3://<bucket>/ --endpoint-url $ENDPOINT
echo "hello" > /tmp/hello.txt
aws s3 cp /tmp/hello.txt s3://<bucket>/farmacore-prod/hello.txt --endpoint-url $ENDPOINT
```

Expected: both commands succeed.

- [ ] **Step 5: No commit (credentials only)**

---

### Task 3: Neon — Postgres project + DB

- [ ] **Step 1: Create project (CLI)**

```bash
neonctl projects create --name farmacore-prod --region-id aws-us-east-1
# → prints { id: 'frosty-bird-12345', ... }
neonctl databases create --name app --project-id <project_id>
```

Pick the region nearest the Fly region (gru for Brazil, iad for US East). For São Paulo + Neon use `aws-sa-east-1` if available; otherwise `aws-us-east-1`.

- [ ] **Step 2: Get both connection URLs**

```bash
# Pooled (PgBouncer endpoint) — used by the app at runtime
neonctl connection-string --project-id <project_id> --pooler

# Direct (no pooler) — used by migrations + CREATE SCHEMA
neonctl connection-string --project-id <project_id>
```

Save both. The pooled URL has `-pooler` in the host.

- [ ] **Step 3: Verify both connect**

```bash
psql "<pooled_url>"   -c 'SELECT 1'
psql "<direct_url>"   -c 'SELECT 1'
```

Expected: both return `1`.

- [ ] **Step 4: Initialize the schemas (one-time)**

Use the **direct** URL — PgBouncer can't handle `CREATE SCHEMA` reliably in transaction-pooling mode.

```bash
psql "<direct_url>" <<'SQL'
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS shared_catalog;
SQL
```

> Plan 01's `npm run migration:run:app` does the same — running this manually is just a smoke test before Fly secrets are set. Plan 01 migrations are also re-applied by Fly's `release_command` on every deploy.

- [ ] **Step 5: No commit**

---

### Task 4: CloudAMQP — RabbitMQ instance

- [ ] **Step 1: Create instance (CLI)**

```bash
cloudamqp instance create --name farmacore-prod --plan tiger --region amazon-web-services::us-east-1
cloudamqp instance list                 # find the id
cloudamqp instance show <id>            # contains the AMQP URL
```

> If the CLI feels clunky, use the dashboard (`customer.cloudamqp.com` → **+ Create New Instance** → Tiger plan).

- [ ] **Step 2: Save AMQP URL + management API credentials**

The AMQP URL looks like `amqps://user:pass@bunny.rmq.cloudamqp.com/vhostname`. The management API is `https://<host>/api` with the same `user:pass`.

- [ ] **Step 3: Sanity-check the management UI**

Open the URL printed by `cloudamqp instance show <id>` → **RabbitMQ Manager** → confirm you can log in.

The exchange and queues will be declared automatically by `QueueModule` (plan 04) on first boot. No manual `rabbitmqadmin` needed.

- [ ] **Step 4: No commit**

---

### Task 5: Fly.io — API app

- [ ] **Step 1: Create the app**

```bash
fly apps create farmacore-api --org <your-org>
```

- [ ] **Step 2: Author fly.api.toml**

Create `fly.api.toml`:

```toml
app = "farmacore-api"
primary_region = "gru"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"
  WORKER_MODE = "0"
  OTEL_SERVICE_NAME = "farmacore-api"

# Release: applies app-level migrations and enqueues tenant migrations.
[deploy]
  release_command = "node dist/scripts/enqueue-migrate-all.js"

[[services]]
  internal_port = 3000
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

  [[services.http_checks]]
    interval = "10s"
    timeout = "2s"
    path = "/health"
    method = "get"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024
```

- [ ] **Step 3: Set secrets**

```bash
fly secrets set --config fly.api.toml --app farmacore-api \
  DATABASE_URL="<pooled_url>" \
  DATABASE_DIRECT_URL="<direct_url>" \
  AMQP_URL="<amqp_url>" \
  R2_ACCESS_KEY_ID="<r2_key>" \
  R2_SECRET_ACCESS_KEY="<r2_secret>" \
  R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  R2_BUCKET="<existing-bucket-name>" \
  R2_KEY_PREFIX="farmacore-prod/" \
  JWT_SECRET="$(openssl rand -base64 48)" \
  INTEGRATION_DB_KEY="$(head -c 32 /dev/urandom | base64)"
```

If you've completed plan 07, also set:

```bash
fly secrets set --app farmacore-api \
  OTEL_EXPORTER_OTLP_ENDPOINT="<vendor_endpoint>" \
  OTEL_EXPORTER_OTLP_HEADERS="api-key=<token>" \
  CLOUDAMQP_API_URL="https://<host>/api" \
  CLOUDAMQP_API_USER="<user>" \
  CLOUDAMQP_API_PASS="<pass>"
```

Verify:

```bash
fly secrets list --app farmacore-api
```

> **Critical:** `JWT_SECRET` and `INTEGRATION_DB_KEY` are sensitive — save copies in a password manager so you can mirror them on the worker app.

- [ ] **Step 4: First deploy**

```bash
fly deploy --config fly.api.toml --app farmacore-api --remote-only
```

`release_command` runs first → applies app + shared migrations, enqueues tenant migrations. Then HTTP servers boot.

- [ ] **Step 5: Verify**

```bash
fly status --app farmacore-api
curl https://farmacore-api.fly.dev/health
# expect: {"status":"ok",...}
```

- [ ] **Step 6: Commit fly.api.toml**

```bash
git add fly.api.toml
git commit -m "feat(infra): fly.api.toml for farmacore-api"
```

---

### Task 6: Fly.io — Worker app

Same image. Different env (`WORKER_MODE=1`). No public services.

- [ ] **Step 1: Create the app**

```bash
fly apps create farmacore-worker --org <your-org>
```

- [ ] **Step 2: Author fly.worker.toml**

Create `fly.worker.toml`:

```toml
app = "farmacore-worker"
primary_region = "gru"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  WORKER_MODE = "1"
  OTEL_SERVICE_NAME = "farmacore-worker"

# No [deploy] release_command — migrations only run from the API app to avoid races.

# No [[services]] block — workers don't accept HTTP.

[[vm]]
  cpu_kind = "shared"
  cpus = 2
  memory_mb = 2048
```

- [ ] **Step 3: Mirror secrets from API app**

Read each secret from the API app and set it on the worker app. The shell helper:

```bash
API_SECRETS=(DATABASE_URL DATABASE_DIRECT_URL AMQP_URL R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
             R2_ENDPOINT R2_BUCKET R2_KEY_PREFIX JWT_SECRET INTEGRATION_DB_KEY \
             OTEL_EXPORTER_OTLP_ENDPOINT OTEL_EXPORTER_OTLP_HEADERS \
             CLOUDAMQP_API_URL CLOUDAMQP_API_USER CLOUDAMQP_API_PASS)

# Easiest: set them by pasting the same values you saved in your password manager.
fly secrets set --config fly.worker.toml --app farmacore-worker \
  DATABASE_URL="<pooled_url>" \
  DATABASE_DIRECT_URL="<direct_url>" \
  AMQP_URL="<amqp_url>" \
  R2_ACCESS_KEY_ID="<r2_key>" \
  R2_SECRET_ACCESS_KEY="<r2_secret>" \
  R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  R2_BUCKET="<existing-bucket-name>" \
  R2_KEY_PREFIX="farmacore-prod/" \
  JWT_SECRET="<same-as-api>" \
  INTEGRATION_DB_KEY="<same-as-api>"
```

> **Critical:** `JWT_SECRET` and `INTEGRATION_DB_KEY` MUST match the API's values. The worker reads/decrypts integration credentials with `INTEGRATION_DB_KEY`; mismatched keys mean every pipeline run fails to decrypt. JWT only matters if you ever validate tokens worker-side, but matching them keeps your options open.

- [ ] **Step 4: Deploy**

```bash
fly deploy --config fly.worker.toml --app farmacore-worker --remote-only
```

- [ ] **Step 5: Verify**

```bash
fly logs --app farmacore-worker | head -50
```

Expected: lines from `QueueModule` declaring the exchange/queues, then `BasePipelineConsumer` registrations. CloudAMQP management UI now shows >0 consumers per queue.

- [ ] **Step 6: Commit fly.worker.toml**

```bash
git add fly.worker.toml
git commit -m "feat(infra): fly.worker.toml for farmacore-worker (WORKER_MODE=1)"
```

---

### Task 7: GitHub Actions — CI/CD

- [ ] **Step 1: Generate Fly API token**

```bash
fly auth token
```

Save the output as the `FLY_API_TOKEN` repo secret in GitHub:
**Repo → Settings → Secrets and variables → Actions → New repository secret.**

- [ ] **Step 2: Deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

env:
  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test

  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.api.toml --remote-only --app farmacore-api

  deploy-worker:
    needs: deploy-api    # API releases migrations; worker comes up after
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --config fly.worker.toml --remote-only --app farmacore-worker
```

> **Note on ordering:** `deploy-worker` depends on `deploy-api` so the worker only restarts after migrations have run. If both deployed in parallel, a worker booting against an old schema could break.

- [ ] **Step 3: Trigger and verify**

Push to `main` (or `workflow_dispatch` the action manually):

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: GitHub Actions deploy workflow"
git push
```

Watch the run in GitHub Actions. Both API and worker should land green within ~5 minutes.

- [ ] **Step 4: Smoke test post-deploy**

```bash
curl https://farmacore-api.fly.dev/health
# expect ok

# Trigger a pipeline manually (requires plan 06's admin API + a system admin user):
TOKEN=$(curl -sX POST https://farmacore-api.fly.dev/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"sysadmin@example.com","password":"...","tenantSlug":"system"}' | jq -r .accessToken)

curl -X POST https://farmacore-api.fly.dev/admin/tenants/<some-slug>/pipeline:start \
  -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 5: Commit**

(Already committed in Step 3.)

---

### Task 8: Optional — Neon PR-preview workflow

Useful but not required for v1. Creates a Neon branch per PR; uses the pooled URL for testing migrations safely.

- [ ] **Step 1: Add Neon API key as repo secret**

```bash
neonctl api-keys create --name github-actions-preview
# → saves a token
```

Add it to GitHub as `NEON_API_KEY` and your project id as `NEON_PROJECT_ID`.

- [ ] **Step 2: Workflow**

Create `.github/workflows/pr-preview.yml`:

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize, closed]

jobs:
  branch:
    runs-on: ubuntu-latest
    if: github.event.action != 'closed'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - uses: neondatabase/create-branch-action@v5
        id: branch
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          branch_name: pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}
      - name: Run migrations against PR branch
        env:
          DATABASE_URL: ${{ steps.branch.outputs.db_url_pooled }}
          DATABASE_DIRECT_URL: ${{ steps.branch.outputs.db_url }}
        run: npm run migration:run:app

  cleanup:
    runs-on: ubuntu-latest
    if: github.event.action == 'closed'
    steps:
      - uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ secrets.NEON_PROJECT_ID }}
          branch_name: pr-${{ github.event.number }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-preview.yml
git commit -m "ci: PR-preview workflow (Neon branch per PR)"
```

---

### Task 9: Optional — Terraform port

Once the CLI walkthroughs are reproducible, port to Terraform so the whole stack is code-reviewable.

> **Scope decision:** Plan 08 ships the CLI walkthrough only. Terraform is documented here as a follow-up sketch (no actual `.tf` files committed until someone needs them). Treat the rest of this task as documentation; don't execute it until the manual steps are stable.

- [ ] **Step 1: Layout** (when you choose to do it)

```
infra/
├─ providers.tf
├─ variables.tf
├─ outputs.tf
├─ r2.tf              # data source — reuse, don't manage
├─ neon.tf
├─ cloudamqp.tf
├─ fly.tf             # apps + IPs + secrets only; machines stay on flyctl
└─ env/prod.tfvars
```

- [ ] **Step 2: Skeleton providers.tf**

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    fly        = { source = "fly-apps/fly",         version = "~> 0.1" }
    neon       = { source = "kislerdm/neon",        version = "~> 0.6" }
    cloudamqp  = { source = "cloudamqp/cloudamqp",  version = "~> 1.30" }
    cloudflare = { source = "cloudflare/cloudflare",version = "~> 4.40" }
  }
}
```

See `arc/05 §7` for the full file set — reproduced verbatim if you decide to commit Terraform.

- [ ] **Step 3: When you commit Terraform**

State: use Terraform Cloud free tier or an S3-compatible R2 backend. Don't store state in the repo.

```bash
git add infra/
git commit -m "feat(infra): Terraform port (apps, IPs, secrets — no machines)"
```

---

### Task 10: First-deploy runbook

**Files:** `docs/provisioning/first-deploy.md`

- [ ] **Step 1: Write**

```markdown
# First Deploy Runbook

Order of operations the first time a fresh environment is brought up. Reference: plan 08.

## 1. Vendors (one-off)

1. **R2** — reuse existing bucket; issue scoped API token (Task 2).
2. **Neon** — `neonctl projects create --name farmacore-prod` (Task 3).
3. **CloudAMQP** — `cloudamqp instance create --plan tiger` (Task 4).

## 2. Fly apps (one-off)

4. `fly apps create farmacore-api`
5. `fly apps create farmacore-worker`

## 3. Secrets (one-off, then on rotation)

6. Generate `JWT_SECRET` and `INTEGRATION_DB_KEY`.
7. Set every secret on `farmacore-api` (Task 5 Step 3).
8. Set the same secrets on `farmacore-worker` (Task 6 Step 3) — **JWT_SECRET and INTEGRATION_DB_KEY MUST match**.

## 4. First deploy

9. `fly deploy --config fly.api.toml --app farmacore-api --remote-only`
   - Runs `release_command`: applies migrations, enqueues tenant migrations.
10. `fly deploy --config fly.worker.toml --app farmacore-worker --remote-only`
    - Workers register consumers, drain the migrate-tenant queue.

## 5. Smoke checks

11. `curl https://farmacore-api.fly.dev/health` → `{"status":"ok",...}`
12. CloudAMQP management UI → confirm >0 consumers per step queue.
13. `psql "<direct_url>" -c "SELECT slug FROM core.tenant"` → `system`.

## 6. First user

14. SSH onto the API VM:
    ```bash
    fly ssh console --app farmacore-api
    node dist/scripts/seed-system-admin.js
    ```
15. Save the printed password in 1Password.
16. From your laptop:
    ```bash
    curl -X POST https://farmacore-api.fly.dev/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"email":"admin@system.local","password":"<saved>","tenantSlug":"system"}'
    ```

## 7. Onboard the first tenant

17. With the admin token from step 16:
    ```bash
    curl -X POST https://farmacore-api.fly.dev/admin/tenants \
      -H "Authorization: Bearer $TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"slug":"acme","name":"Acme Pharma","adminEmail":"admin@acme.test"}'
    ```
18. Save the returned `oneTimePassword` and forward to the tenant admin.

## 8. Set up CI

19. Add `FLY_API_TOKEN` to GitHub Actions secrets.
20. Push to `main`; the workflow tests + deploys both apps.

## 9. Going forward

Every deploy = `git push`. The `release_command` ensures migrations run before traffic hits new code. Worker deploy follows API deploy (`needs: deploy-api`).
```

- [ ] **Step 2: Commit**

```bash
git add docs/provisioning/first-deploy.md
git commit -m "docs(provisioning): first-deploy runbook"
```

---

### Task 11: Teardown runbook

**Files:** `docs/provisioning/teardown.md`

- [ ] **Step 1: Write**

```markdown
# Teardown

Destroys the environment created by plan 08. **Irreversible.** Take backups first.

## 1. Back up data

```bash
# Direct (non-pooled) URL; pg_dump all three schemas.
pg_dump "<direct_url>" --schema=core --schema=shared_catalog -f /tmp/farmacore-backup.dump --format=custom
# Per-tenant
for slug in $(psql "<direct_url>" -At -c "SELECT schema_name FROM core.tenant WHERE slug <> 'system'"); do
  pg_dump "<direct_url>" --schema="$slug" -f "/tmp/$slug.dump" --format=custom
done
# Upload to R2 (or S3) for archival.
```

## 2. Drain CloudAMQP queues

Inspect DLQs first — anything left there is unprocessed work:

```bash
# Plan 06 admin endpoint
curl -H "Authorization: Bearer $TOKEN" \
  "https://farmacore-api.fly.dev/admin/dlq/sync-base-product?limit=100"
```

## 3. Destroy Fly apps

```bash
fly apps destroy farmacore-api --yes
fly apps destroy farmacore-worker --yes
```

## 4. Destroy Neon project

```bash
neonctl projects delete --project-id <id>
```

## 5. Destroy CloudAMQP instance

```bash
cloudamqp instance delete <id>
```

## 6. R2 — DO NOT DELETE BUCKET

The bucket is shared with the prototype. Revoke the new app's scoped API token instead:

```
Cloudflare dashboard → R2 → Manage R2 API Tokens → Revoke <new app token>
```

Optionally delete the app's key prefix:

```bash
aws s3 rm s3://<bucket>/farmacore-prod/ --recursive --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

## 7. Remove GitHub secrets

Repo → Settings → Secrets and variables → Actions → remove `FLY_API_TOKEN`, `NEON_API_KEY` (if set), `NEON_PROJECT_ID`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/provisioning/teardown.md
git commit -m "docs(provisioning): teardown runbook"
```

---

## Exit Criteria

- [ ] `fly apps list` shows both `farmacore-api` and `farmacore-worker`.
- [ ] `curl https://farmacore-api.fly.dev/health` returns 200.
- [ ] CloudAMQP management UI shows the 8 step queues + 8 DLQs + the retry queues, all with >0 consumers (workers attached).
- [ ] A `psql "<direct_url>" -c "SELECT 1"` succeeds; `\dn` lists `core`, `shared_catalog`, and at least one `tenant_<slug>`.
- [ ] R2 token is bucket-scoped; smoke test object PUT succeeds.
- [ ] `git push` to `main` → GitHub Actions deploys both apps without manual intervention; release_command runs migrations before HTTP traffic.
- [ ] `JWT_SECRET` and `INTEGRATION_DB_KEY` are identical on both Fly apps (verified by integration test from plan 03 against the prod DB).
- [ ] Total monthly spend matches the table in `arc/00 §8` (~$115–145).
- [ ] `docs/provisioning/first-deploy.md` and `docs/provisioning/teardown.md` cover the runbooks.
