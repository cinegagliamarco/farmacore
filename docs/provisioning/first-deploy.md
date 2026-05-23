# First Deploy Runbook

End-to-end first-time provisioning for the Farmacore production environment. Reference: `plans/08-provisioning.md`.

Everything below assumes you have a Fly.io, Neon, CloudAMQP, Cloudflare, and GitHub account, each with billing set up where required.

---

## 0. Install CLIs

```bash
brew install flyctl
npm install -g neonctl
# CloudAMQP CLI is optional — dashboard works too
brew install cloudamqp/cloudamqp/cloudamqp-cli
```

Authenticate:

```bash
fly auth login
neonctl auth
cloudamqp login          # paste your CLOUDAMQP_APIKEY when prompted
```

---

## 1. Cloudflare R2 — reuse existing bucket

The R2 bucket is shared with the prototype. We only issue a new scoped API token so the new app has independent credentials.

1. Cloudflare dashboard → **R2** → note the bucket name and **Account ID**.
2. **Manage R2 API Tokens** → **Create API Token**
   - Permission: Object Read & Write
   - Specify bucket: the existing bucket only
   - TTL: 1 year (rotate annually)
3. Save the **Access Key ID** + **Secret Access Key** (shown once) in a password manager.
4. Pick a key prefix to isolate from the prototype, e.g. `farmacore-prod/`.
5. Smoke test:
   ```bash
   export AWS_ACCESS_KEY_ID=<r2_key>
   export AWS_SECRET_ACCESS_KEY=<r2_secret>
   export AWS_DEFAULT_REGION=auto
   ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   echo hello > /tmp/hello.txt
   aws s3 cp /tmp/hello.txt s3://<bucket>/farmacore-prod/hello.txt --endpoint-url $ENDPOINT
   aws s3 ls s3://<bucket>/farmacore-prod/ --endpoint-url $ENDPOINT
   ```

---

## 2. Neon — Postgres project

```bash
neonctl projects create --name farmacore-prod --region-id aws-us-east-1
# → prints the project id
neonctl databases create --name app --project-id <project_id>
```

Region: pick the one closest to your Fly `primary_region`. The example `fly.api.toml` uses `gru` (São Paulo); pair with `aws-sa-east-1` if Neon offers it, otherwise `aws-us-east-1`.

Grab both connection URLs:

```bash
# Pooled (PgBouncer endpoint) — used by the app at runtime
neonctl connection-string --project-id <project_id> --pooler
# Direct (no pooler) — used by migrations + CREATE SCHEMA
neonctl connection-string --project-id <project_id>
```

Verify each:

```bash
psql "<pooled_url>" -c 'SELECT 1'
psql "<direct_url>" -c 'SELECT 1'
```

(Optional sanity-check before secrets are set — Plan 01's `npm run migration:run:app` creates `core` + `shared_catalog` schemas; the `release_command` on Fly does this automatically on every deploy.)

---

## 3. CloudAMQP — RabbitMQ instance

```bash
cloudamqp instance create --name farmacore-prod --plan tiger --region amazon-web-services::us-east-1
cloudamqp instance list
cloudamqp instance show <id>
```

Save the AMQP URL (`amqps://user:pass@host/vhost`). The exchange and queues are declared automatically by `QueueModule` (Plan 04) on first boot.

---

## 4. Fly apps

```bash
fly apps create farmacore-api    --org <your-org>
fly apps create farmacore-worker --org <your-org>
```

---

## 5. Secrets

Generate the cryptographic secrets first — they MUST be identical on both apps:

```bash
JWT_SECRET=$(openssl rand -base64 48)
INTEGRATION_DB_KEY=$(head -c 32 /dev/urandom | base64)
echo "Save these in a password manager:"
echo "  JWT_SECRET=$JWT_SECRET"
echo "  INTEGRATION_DB_KEY=$INTEGRATION_DB_KEY"
```

> **Critical:** `INTEGRATION_DB_KEY` decrypts integration credentials at runtime; if the worker's key doesn't match the API's, every pipeline run will fail to decrypt the per-tenant ERP credentials.

Set secrets on the API app:

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
  JWT_SECRET="$JWT_SECRET" \
  INTEGRATION_DB_KEY="$INTEGRATION_DB_KEY"
```

Mirror them to the worker app:

```bash
fly secrets set --config fly.worker.toml --app farmacore-worker \
  DATABASE_URL="<pooled_url>" \
  DATABASE_DIRECT_URL="<direct_url>" \
  AMQP_URL="<amqp_url>" \
  R2_ACCESS_KEY_ID="<r2_key>" \
  R2_SECRET_ACCESS_KEY="<r2_secret>" \
  R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com" \
  R2_BUCKET="<existing-bucket-name>" \
  R2_KEY_PREFIX="farmacore-prod/" \
  JWT_SECRET="$JWT_SECRET" \
  INTEGRATION_DB_KEY="$INTEGRATION_DB_KEY"
```

Verify:

```bash
fly secrets list --app farmacore-api
fly secrets list --app farmacore-worker
```

(After Plan 07 lands observability, also set `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on both.)

---

## 6. First deploy

```bash
fly deploy --config fly.api.toml    --app farmacore-api    --remote-only
fly deploy --config fly.worker.toml --app farmacore-worker --remote-only
```

The API release_command runs `node dist/scripts/enqueue-migrate-all.js` before HTTP traffic is routed:

1. Runs app-level migrations (`core` + `shared_catalog`).
2. Reads `core.tenant` and publishes `<slug>.migrate-tenant` to the queue for each active tenant.

After API is healthy, deploy the worker — its `MigrateTenantConsumer` drains the migrate-tenant queue (parallelism 10) and applies each tenant's template migrations.

---

## 7. Smoke checks

```bash
fly status --app farmacore-api
fly status --app farmacore-worker

curl https://farmacore-api.fly.dev/health
# → {"status":"ok"}

psql "<direct_url>" -c "SELECT slug FROM core.tenant"
# → system  (seeded by InitCore1700000000000)

# CloudAMQP management UI should show >0 consumers on each step queue.
```

---

## 8. First admin user

SSH into the API VM and seed the system admin:

```bash
fly ssh console --app farmacore-api
# inside the VM:
export SEED_ADMIN_EMAIL="admin@<your-domain>"
export SEED_ADMIN_PASSWORD="$(openssl rand -base64 24)"
node dist/scripts/seed-system-admin.js
echo "Save: $SEED_ADMIN_PASSWORD"
exit
```

Log in from your laptop:

```bash
curl -X POST https://farmacore-api.fly.dev/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@<your-domain>\",\"password\":\"<saved>\",\"tenantSlug\":\"system\"}"
# → { accessToken, refreshToken, expiresIn }
```

---

## 9. Onboard the first tenant

```bash
TOKEN="<accessToken from step 8>"
curl -X POST https://farmacore-api.fly.dev/admin/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"acme","name":"Acme Pharma","adminEmail":"admin@acme.test"}'
# → { slug, schemaName, initialAdminUser: { email, oneTimePassword } }
```

Forward `oneTimePassword` to the tenant admin.

---

## 10. CI/CD

```bash
fly auth token
# Copy the printed token into:
# GitHub → repo → Settings → Secrets and variables → Actions → New repository secret
# Name: FLY_API_TOKEN
```

Push to `main`. The `Deploy` workflow runs lint + tests, deploys API, then deploys worker (in that order — the worker `needs: deploy-api` so migrations land before consumers restart).

(Optional) For Neon PR-preview branches, also add `NEON_PROJECT_ID` and `NEON_API_KEY` (`neonctl api-keys create --name github-actions-preview`).

---

## Going forward

Every deploy = `git push origin main`. The `release_command` ensures migrations run before traffic hits new code. Worker deploy follows the API. See `teardown.md` if you need to roll the environment back down.
