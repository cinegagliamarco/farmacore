# 05 — Provisioning Tutorial

**Date:** 2026-05-12
**Status:** Draft

## Purpose

Step-by-step guide to bring up every cloud resource the spec needs, from zero. Covers two paths for each resource:

- **CLI / dashboard** — what to do once, by hand, when you're trying things out.
- **Terraform** — the same thing as code, for repeatability and PR review.

Recommended path: do the **CLI walk-through end-to-end first** to validate the architecture, then port to Terraform once the shape is right.

Resources covered, in dependency order:

1. Cloudflare R2 bucket — **already exists in the prototype; we reuse it**
2. Neon project + database
3. CloudAMQP RabbitMQ instance
4. Fly.io app (API)
5. Fly.io app (worker) — same image, different process
6. GitHub Actions CI/CD wiring
7. (Optional) Terraform layout for all of the above

## 0. Prerequisites

Install once:

```bash
# Fly CLI
brew install flyctl
fly auth signup   # or: fly auth login

# Terraform (optional, used in §7)
brew install terraform

# Accounts you'll need (free signups):
# - Fly.io                — https://fly.io
# - Neon                  — https://neon.tech
# - CloudAMQP             — https://cloudamqp.com
# - Cloudflare            — https://cloudflare.com (R2 needs payment-method on file)
# - GitHub                — for CI/CD
```

Generate API tokens once you've signed up; you'll paste them as you go:

| Vendor | Token name | Where |
|---|---|---|
| Fly.io | `FLY_API_TOKEN` | `fly auth token` |
| Neon | `NEON_API_KEY` | Console → Account Settings → API Keys |
| CloudAMQP | `CLOUDAMQP_APIKEY` | Console → Customer API Keys |
| Cloudflare | `CLOUDFLARE_API_TOKEN` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` | Dashboard → R2 → Manage API Tokens |

Keep all of these in a password manager. Don't commit any of them.

---

## 1. Cloudflare R2 — Object Storage

**Reuse the existing bucket from the `farmacore` prototype.** The prototype already provisioned a Cloudflare R2 bucket and credentials; we'll point the new app at the same bucket rather than creating a new one. R2 is S3-compatible (zero egress fees), so anything that speaks S3 (`@aws-sdk/client-s3`) works against it.

### 1a. Reuse the existing bucket

1. Identify the existing bucket (Cloudflare dashboard → **R2**). Note:
   - **Bucket name** (e.g. `farmacore-assets`).
   - **Account ID** (top of the R2 page). S3-compatible endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
2. Decide on credentials:
   - **Recommended:** issue a **new API token scoped to this bucket only** for the new app, so the prototype and the new app have independent rotation paths.
     - R2 → **Manage R2 API Tokens** → **Create API Token**.
     - Permission: **Object Read & Write**.
     - Specify bucket: the existing bucket.
     - Save the **Access Key ID** and **Secret Access Key** — they appear only once.
   - **Alternative:** reuse the prototype's existing token (faster but couples lifecycles).

### 1b. Optional: prefix-isolate the new app's objects

If both the prototype and the new app will write to the bucket simultaneously, give the new app a key prefix (e.g. `farmacore-prod/`) and enforce it in the app code. Avoids accidental key collisions and makes per-app object-level cleanup possible.

### 1c. Smoke test

```bash
# Save creds in your shell, do not commit:
export AWS_ACCESS_KEY_ID=<r2_access_key>
export AWS_SECRET_ACCESS_KEY=<r2_secret>
export AWS_DEFAULT_REGION=auto

aws s3 ls s3://<existing-bucket-name>/ --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
echo "hello" > /tmp/hello.txt
aws s3 cp /tmp/hello.txt s3://<existing-bucket-name>/farmacore-prod/hello.txt \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

If the upload succeeds, the bucket is wired up.

### 1d. Need a fresh bucket later?

The original "create a new bucket" instructions are kept here for the case where you decide to give the new app its own R2 bucket:

<details>
<summary>Create a new R2 bucket from scratch</summary>

1. Cloudflare dashboard → **R2** → **Create bucket**.
2. Name: `farmacore-prod-assets` (must be globally unique within your account).
3. Location: **Automatic** (Cloudflare picks based on access patterns).
4. After creation → **Settings** → **Public Access** → leave it **off** unless you actually need public URLs.
5. **Manage R2 API Tokens** → **Create API Token** scoped to this bucket only.
6. Wrangler CLI alternative:
   ```bash
   npm install -g wrangler
   wrangler login
   wrangler r2 bucket create farmacore-prod-assets
   ```
   API tokens still come from the dashboard.

</details>

---

## 2. Neon — Postgres

### 2a. Dashboard

1. neon.tech → **New Project**.
2. Name: `farmacore-prod`. Region: pick the one nearest your Fly region (São Paulo for `gru`, Virginia for `iad`, etc.).
3. Postgres version: **17** (or latest stable).
4. Database name: `app`. Role: `app` (default).
5. Plan: **Launch** ($19/mo) or **Scale** ($69/mo) depending on tenant headroom — see `00-architecture.md` §8.
6. After creation, copy two connection strings from the **Connection Details** panel:
   - **Pooled** (`-pooler` host) — use this in the app. Example:
     ```
     postgres://app:<password>@ep-cool-name-12345-pooler.us-east-2.aws.neon.tech/app?sslmode=require
     ```
   - **Direct** — use only for migrations (PgBouncer can't run `CREATE SCHEMA` reliably in transaction-pooling mode).
7. Optional: enable **autoscaling** (compute scales between min/max CUs). Min 0.25, max 2 for a small prod is fine.

### 2b. CLI alternative — `neonctl`

```bash
npm install -g neonctl
neonctl auth                          # opens browser

# Create the project + DB
neonctl projects create --name farmacore-prod --region-id aws-us-east-1
neonctl databases create --name app --project-id <project_id>

# Show the connection string
neonctl connection-string --project-id <project_id> --pooler
```

### 2c. Initialize the schemas

This is one-time per environment. Use the **direct** (non-pooled) connection string:

```bash
psql "postgres://app:<pwd>@ep-...neon.tech/app?sslmode=require" <<'SQL'
CREATE SCHEMA IF NOT EXISTS app_meta;
CREATE SCHEMA IF NOT EXISTS shared_catalog;
-- Tenant schemas are created at onboarding time, see 03-auth-and-tenancy.md
SQL
```

Then run your TypeORM migrations (`npm run migration:run`) against each schema. Migration runner setup is in `01-database-schema.md` §7 and `02-queue-and-routines.md` §8.

### 2d. Neon branching (optional but very useful)

Each PR can get its own DB branch (copy-on-write, free, takes seconds):

```bash
neonctl branches create --name pr-123 --parent main
neonctl connection-string --branch pr-123
```

Configure GitHub Actions to create a branch on PR open and delete on close.

---

## 3. CloudAMQP — RabbitMQ

### 3a. Dashboard

1. customer.cloudamqp.com → **+ Create New Instance**.
2. Name: `farmacore-prod`. Plan: **Tiger** ($19/mo) for v1.
3. Region: same continent as Fly/Neon. For us-east-* Fly + Neon, pick `Amazon Web Services · us-east-1`.
4. Tags: `env=prod,project=farmacore`.
5. Click **Create**.
6. Open the new instance → **Details** tab → copy the **AMQP URL**:
   ```
   amqps://user:pass@bunny.rmq.cloudamqp.com/vhostname
   ```
7. **RabbitMQ Manager** button → opens the standard management UI for inspecting queues, exchanges, DLQs.

### 3b. CLI alternative

```bash
# CloudAMQP has a small CLI: https://github.com/cloudamqp/cloudamqp-cli
brew install cloudamqp/cloudamqp/cloudamqp-cli
cloudamqp login                       # uses CLOUDAMQP_APIKEY
cloudamqp instance create --name farmacore-prod --plan tiger --region amazon-web-services::us-east-1
cloudamqp instance list
cloudamqp instance show <id>          # contains the AMQP URL
```

### 3c. Declare exchange + queues

Either via the management UI, via your app's NestJS `@golevelup/nestjs-rabbitmq` config (auto-declares on boot), or one-shot via `rabbitmqadmin`:

```bash
rabbitmqadmin --uri="amqps://..." declare exchange name=pipeline.prod type=topic durable=true

for step in sync-base-product sync-base-product-stock sync-offer-books-info \
            import-competitor-products calc-base-product-metrics \
            update-base-product-properties update-active-ingredient-mat; do
  rabbitmqadmin --uri="amqps://..." declare queue name=$step durable=true \
    arguments='{"x-dead-letter-exchange":"","x-dead-letter-routing-key":"'$step'.dlq"}'
  rabbitmqadmin --uri="amqps://..." declare queue name=$step.dlq durable=true
  rabbitmqadmin --uri="amqps://..." declare binding source=pipeline.prod destination=$step routing_key="*.$step"
done
```

The full topology is described in `02-queue-and-routines.md` §3.

---

## 4. Fly.io — API app

### 4a. Bootstrap the app

From the repo root (with a `Dockerfile` already in place):

```bash
fly launch --no-deploy --name farmacore-api --region gru \
  --org your-org --copy-config=false --no-cache
```

`fly launch` writes a `fly.toml`. Open it and tighten:

```toml
app = "farmacore-api"
primary_region = "gru"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[[services]]
  internal_port = 3000
  protocol      = "tcp"
  auto_stop_machines  = false
  auto_start_machines = true
  min_machines_running = 1

  [[services.ports]]
    handlers = ["http"]
    port     = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port     = 443

  [[services.http_checks]]
    interval = "10s"
    timeout  = "2s"
    path     = "/health"

[[vm]]
  cpu_kind = "shared"
  cpus     = 1
  memory_mb = 1024
```

### 4b. Inject secrets

```bash
fly secrets set \
  DATABASE_URL="postgres://app:...neon.tech/app?sslmode=require" \
  AMQP_URL="amqps://...cloudamqp.com/..." \
  R2_ACCESS_KEY_ID="..." \
  R2_SECRET_ACCESS_KEY="..." \
  R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  R2_BUCKET="<existing-bucket-name>" \
  R2_KEY_PREFIX="farmacore-prod/" \  # optional, if sharing the bucket with the prototype
  JWT_SECRET="$(openssl rand -base64 48)" \
  INTEGRATION_DB_KEY="$(openssl rand -base64 32)" \
  --app farmacore-api
```

Verify:

```bash
fly secrets list --app farmacore-api
```

### 4c. First deploy

```bash
fly deploy --app farmacore-api
fly logs --app farmacore-api
fly status --app farmacore-api
curl https://farmacore-api.fly.dev/health
```

### 4d. Custom domain (optional)

```bash
fly certs create api.farmacore.example.com --app farmacore-api
fly certs show api.farmacore.example.com --app farmacore-api
# Follow the displayed DNS instructions (CNAME or A/AAAA).
```

---

## 5. Fly.io — Worker app

The worker runs the same Docker image as the API but a different entrypoint. Two ways to model this on Fly:

- **Same `fly.toml` with `[processes]`** — single app, single deploy, two process types. Simplest.
- **Separate Fly app** — clean separation, independent scaling, separate logs. Slightly more setup.

For the spec, go with **separate apps** so workers and API scale independently and you can target them in dashboards. Keep the same image.

### 5a. Bootstrap

```bash
fly launch --no-deploy --name farmacore-worker --region gru \
  --org your-org --copy-config=false --no-cache --image-only
```

Edit `fly.worker.toml`:

```toml
app = "farmacore-worker"
primary_region = "gru"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  WORKER_MODE = "1"

# No public [[services]] block — workers don't accept HTTP.

[[vm]]
  cpu_kind = "shared"
  cpus     = 2
  memory_mb = 2048

# Override the container CMD to launch the worker bootstrap:
[processes]
  worker = "node dist/worker.main.js"

[[services]]
  processes = ["worker"]
  # Empty services block; required so Fly still keeps the machine alive
```

### 5b. Secrets

The worker needs the same secrets as the API:

```bash
# Copy secrets from API → worker:
fly secrets list --app farmacore-api --json | jq -r '.[].Name' | \
  while read name; do
    fly secrets set "$name=$(fly ssh console --app farmacore-api -C "printenv $name" 2>/dev/null || echo '')" --app farmacore-worker --stage   # --stage queues secrets; deploy them with `fly secrets deploy`
  done
fly secrets deploy --app farmacore-worker
```

Or more simply: keep an `.env.prod` file locally and run a single `fly secrets set` on both apps.

### 5c. Deploy

```bash
fly deploy --config fly.worker.toml --app farmacore-worker
fly logs --app farmacore-worker
```

Workers should connect to RabbitMQ at boot and report consumer counts increasing in the CloudAMQP management UI.

---

## 6. GitHub Actions — CI/CD

Add `FLY_API_TOKEN` to **GitHub repo → Settings → Secrets and variables → Actions**.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test

  deploy-api:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --app farmacore-api

  deploy-worker:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only --config fly.worker.toml --app farmacore-worker
```

Migrations should run as a Fly **release command**, declared in `fly.toml`:

```toml
[deploy]
  release_command = "node dist/migrations/run.js"
```

This guarantees migrations complete before the new app version starts taking traffic.

---

## 7. Terraform (optional — same stack as code)

Once the CLI walk-through works, port to Terraform so the whole stack is reproducible.

### 7a. Layout

```
infra/
├─ providers.tf
├─ variables.tf
├─ outputs.tf
├─ r2.tf
├─ neon.tf
├─ cloudamqp.tf
├─ fly.tf
└─ env/
   └─ prod.tfvars   # v1 ships production-only; add more files if a staging env is introduced later
```

### 7b. `providers.tf`

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

provider "fly"        { fly_api_token = var.fly_api_token }
provider "neon"       { api_key       = var.neon_api_key }
provider "cloudamqp"  { apikey        = var.cloudamqp_apikey }
provider "cloudflare" { api_token     = var.cloudflare_api_token }
```

### 7c. `r2.tf`

The bucket is shared with the prototype, so we **don't manage it as a Terraform resource** (avoids accidental destroy). Reference it as a data source instead:

```hcl
data "cloudflare_r2_bucket" "assets" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name   # e.g. "farmacore-assets" — set in prod.tfvars
}

# Outputs make the bucket name/endpoint available to the rest of the stack:
output "r2_bucket_name" { value = data.cloudflare_r2_bucket.assets.name }
output "r2_endpoint"    { value = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com" }
```

API tokens for R2 still have to be issued in the dashboard (scoped to this bucket only for the new app) and pasted into TF vars; Cloudflare's provider doesn't issue them.

If you ever decide to give the new app its own bucket, swap the `data` block for a `resource "cloudflare_r2_bucket"`.

### 7d. `neon.tf`

```hcl
resource "neon_project" "app" {
  name      = "farmacore-prod"
  region_id = "aws-us-east-2"
  pg_version = 17
}

resource "neon_database" "app" {
  project_id = neon_project.app.id
  branch_id  = neon_project.app.default_branch_id
  name       = "app"
  owner_name = "app"
}

output "neon_connection_string" {
  value     = neon_project.app.default_endpoint.pooler_uri
  sensitive = true
}
```

### 7e. `cloudamqp.tf`

```hcl
resource "cloudamqp_instance" "broker" {
  name   = "farmacore-prod"
  plan   = "tiger"
  region = "amazon-web-services::us-east-1"
  tags   = ["env:prod", "project:farmacore"]
}

output "amqp_url" {
  value     = cloudamqp_instance.broker.url
  sensitive = true
}
```

### 7f. `fly.tf`

```hcl
resource "fly_app" "api" {
  name = "farmacore-api"
  org  = var.fly_org
}

resource "fly_app" "worker" {
  name = "farmacore-worker"
  org  = var.fly_org
}

resource "fly_ip" "api_v4" { app = fly_app.api.name; type = "v4" }
resource "fly_ip" "api_v6" { app = fly_app.api.name; type = "v6" }

# Secrets — Terraform stores the desired state; values come from TF_VAR_* envs
resource "fly_secret" "api_database_url" {
  app   = fly_app.api.name
  name  = "DATABASE_URL"
  value = neon_project.app.default_endpoint.pooler_uri
}

resource "fly_secret" "api_amqp_url" {
  app   = fly_app.api.name
  name  = "AMQP_URL"
  value = cloudamqp_instance.broker.url
}

# Machines are deployed by flyctl from CI, not by Terraform.
# Terraform only owns the app shells, IPs, and secrets.
```

**Important:** machines/deploys stay on `flyctl`. Don't manage them in Terraform — Terraform would fight the CI deploy on every push.

### 7g. Workflow

```bash
cd infra
terraform init
terraform workspace new prod
terraform plan  -var-file=env/prod.tfvars
terraform apply -var-file=env/prod.tfvars
```

State storage: use an **S3-compatible backend** (R2 works) or **Terraform Cloud** (free tier covers a small team).

---

## 8. Putting It All Together

Order in which a brand-new environment is created:

1. R2 bucket — **already exists from the prototype**; just issue a new API token for the new app (`§1`).
2. Neon project + DB + schemas (`§2`).
3. CloudAMQP instance + queues (`§3`).
4. Fly API app + secrets + first deploy (`§4`).
5. Fly worker app + secrets + first deploy (`§5`).
6. GitHub Actions wired to deploy on push (`§6`).
7. (Once stable) replicate in Terraform (`§7`).

You're done when:

- `curl https://farmacore-api.fly.dev/health` returns 200.
- CloudAMQP management UI shows the 8 step queues + 8 DLQs.
- Worker logs show consumer registration on each queue.
- A test admin-API call onboards a tenant, creates a `tenant_<slug>` schema, and a sample pipeline message flows through end-to-end.

## 9. Cost Recap (per environment, at the small end)

| Resource | Plan | Monthly |
|---|---|---|
| Fly API (`shared-cpu-1x@1GB`) | Pay-as-you-go | ~$5 |
| Fly worker (`shared-cpu-2x@2GB`) | Pay-as-you-go | ~$15 |
| Neon Scale | $69 + usage | $69–100 |
| CloudAMQP Tiger | $19 | $19 |
| R2 (small bucket) | Pay-as-you-go | ~$5 |
| **Total** | | **~$115–145/mo** |

V1 is production-only — pre-prod work runs on a Neon branch off `farmacore-prod` (free, copy-on-write) and a local Docker RabbitMQ.

## 10. Teardown

Everything created here can be deleted via the same tools:

```bash
fly apps destroy farmacore-api --yes
fly apps destroy farmacore-worker --yes
neonctl projects delete --project-id <id>
cloudamqp instance delete <id>
# R2 bucket: do NOT delete — it's shared with the prototype.
# Instead, revoke the new app's scoped API token, and (optionally) delete its key prefix:
# aws s3 rm s3://<bucket>/farmacore-prod/ --recursive --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

Or, if you went the Terraform route: `terraform destroy -var-file=env/prod.tfvars`.
