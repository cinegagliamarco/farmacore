# Farmacore Tutorial

End-to-end walkthrough for a fresh developer: get the app running locally, exercise the API, run the test suites, and deploy to Fly.io. For architecture context see [`arc/`](./arc/); for the per-feature implementation plans see [`plans/`](./plans/).

> Companion docs
> - [`README.md`](./README.md) — one-screen quickstart
> - [`docs/provisioning/first-deploy.md`](./docs/provisioning/first-deploy.md) — first-time cloud setup (Fly + Neon + CloudAMQP + R2 + GitHub Actions)
> - [`docs/provisioning/teardown.md`](./docs/provisioning/teardown.md) — environment teardown
> - [`postman/README.md`](./postman/README.md) — Postman collection sync rules
> - [`plans/README.md`](./plans/README.md) — plan status table

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20 LTS | `nvm install 20` |
| npm | ≥ 9 | bundled with Node 20 |
| Docker | latest | for postgres + rabbitmq + (optional) erp |
| flyctl | latest | only needed when you deploy |
| psql | 14+ | optional — we run `psql` inside the container for most checks |

```bash
node --version
npm --version
docker --version
```

---

## 2. Local setup (one-time)

```bash
git clone <repo-url> farmacore
cd farmacore

npm install
cp .env.example .env
```

Default `.env` points at the docker-compose stack with non-default host ports (postgres `:5433`, rabbitmq `:5673` + management `:15673`). The remap avoids clashing with other dev stacks; the URLs inside compose stay standard.

Bring up the stack:

```bash
docker compose up -d            # postgres + rabbitmq + erp (optional)
```

Apply migrations and seed:

```bash
npm run migration:run:app                       # core + shared_catalog schemas
npm run seed:local-tenant                       # macfarma tenant + ERP integration (ngrok)
npm run seed:system-admin                       # admin@system.local in core."user"
```

> `seed:local-tenant` creates the `macfarma` tenant (schema + migrations) and wires
> its A7Pharma ERP connection to the shared ngrok dev database. It does §5.3 + §5.4
> for you — those manual curl steps are only needed for *additional* tenants.

> Adjust seed credentials with env: `SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=… npm run seed:system-admin`.

---

## 3. Run the app

The app ships as **two entry files** in one Docker image:

| Entry | Role | Listens on HTTP? |
|---|---|---|
| `src/main.http.ts` | API | yes (`PORT`, default `3000`) |
| `src/main.worker.ts` | RMQ consumers | no |

### Dev (watch mode)

```bash
npm run start:dev               # API
npm run start:worker:dev        # worker (in a second terminal)
```

### Production-style (compiled)

```bash
npm run build && npm run build:scripts
node dist/main.http.js          # API
node dist/main.worker.js        # worker
```

`npm run start` is an alias for `nest start` and boots the API too.

---

## 4. Run tests

```bash
npm test                        # unit tests (jest)
npm run test:watch              # unit tests in watch mode
npm run test:cov                # coverage report
npm run test:e2e                # e2e suite (needs the docker-compose stack up)
npm run lint                    # eslint --fix
npm run build                   # nest build → dist/
```

The e2e suite forces `NODE_ENV=development` via [`test/setup-e2e-env.ts`](./test/setup-e2e-env.ts) so its RMQ queue topology lines up with the running broker.

---

## 5. Exercise the API with curl

The HTTP surface so far is documented in the Postman collection (next section). The curl snippets below cover the most common flows.

### 5.1 Health

```bash
curl -s http://localhost:3000/health
# → {"status":"ok"}
```

### 5.2 Log in (system admin)

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "admin@system.local",
    "password": "changeme-please-32-chars-or-more",
    "tenantSlug": "system"
  }' | jq -r .accessToken)

echo "TOKEN=$TOKEN"
curl -sS http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
# → { "sub": "...", "tenantId": "system", "role": "admin", "iat": ..., "exp": ... }
```

Replace `password` with whatever you set via `SEED_ADMIN_PASSWORD`.

### 5.3 Onboard a tenant (system admin)

```bash
curl -sS -X POST http://localhost:3000/admin/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme",
    "name": "Acme Pharma",
    "adminEmail": "admin@acme.test"
  }'
# → { "slug": "acme", "schemaName": "tenant_acme",
#     "initialAdminUser": { "email": "...", "oneTimePassword": "..." } }
```

Save the `oneTimePassword` — it's the only time it's shown. Future calls as that tenant admin use `tenantSlug: "acme"`.

### 5.4 Wire the tenant's ERP connection

```bash
curl -sS -X PUT "http://localhost:3000/admin/tenants/acme/integration" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "origin": "a7pharma",
    "name": "Local ERP",
    "host": "localhost",
    "port": 5435,
    "database": "erp",
    "username": "erp",
    "password": "erp",
    "sslMode": "disable",
    "readOnly": true
  }'

curl -sS -X POST "http://localhost:3000/admin/tenants/acme/integration/test" \
  -H "Authorization: Bearer $TOKEN"
# → { "ok": true }
```

> **Per tenant, not global.** Each tenant has its own integration row, and `origin` selects the entity set the worker loads when it connects to *that* tenant's ERP. The first wave of tenants is on `"a7pharma"`; subsequent tenants can be on a different vendor without touching the others — the factory keys the entity set by `row.origin` (see `src/integration/entities/index.ts → entitiesForOrigin`). Adding a vendor = new folder under `src/integration/entities/<vendor>/` + new `IntegrationOrigin` enum value + one entry in `ENTITIES_BY_ORIGIN` + relax the migration's `CHECK origin IN (...)`.

### 5.5 Enable competitor origins

```bash
curl -sS -X PUT "http://localhost:3000/admin/tenants/acme/competitor-origins" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "origins": [
      { "origin": "DROGAL",      "enabled": true,  "priority": 100 },
      { "origin": "DROGASIL",    "enabled": true,  "priority": 50 },
      { "origin": "PAGUE_MENOS", "enabled": false }
    ]
  }'
```

### 5.5b Grant module access

Each tenant sees only the modules enabled on `core.tenant.modules` (all on by
default at onboarding). Routes gated by `@RequireModule` return 403 when the
module is off; the FE reads the enabled list from `GET /auth/me` (`modules`).

```bash
curl -sS -X PUT "http://localhost:3000/admin/tenants/acme/modules" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "modules": [
      "crossed-products",
      "active-ingredient-analysis",
      "pricing-rules",
      "offer-book-rules",
      "strategic-pricing"
    ]
  }'
```

### 5.6 Trigger a pipeline run

```bash
curl -sS -X POST "http://localhost:3000/admin/tenants/acme/pipeline/start" \
  -H "Authorization: Bearer $TOKEN"
# → { "pipelineRunId": "...uuid..." }
```

Watch progress in `core.pipeline_run`:

```bash
docker exec -i farmacore-postgres-1 psql -U app -d app -c "
  SELECT step, status, attempt
    FROM core.pipeline_run
   WHERE pipeline_run_id = '<pipelineRunId>'
   ORDER BY started_at;
"
```

Expected on a successful run: 8 step rows + 2 `branch.*` rows, all `completed`.

### 5.7 Inspect / replay the DLQ

```bash
# Peek (doesn't consume)
curl -sS "http://localhost:3000/admin/dlq/sync-base-product?limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq

# Replay everything in the DLQ back to the main exchange
curl -sS -X POST "http://localhost:3000/admin/dlq/sync-base-product/replay?max=100" \
  -H "Authorization: Bearer $TOKEN"
# → { "replayed": N }
```

### 5.8 Tenant-facing API (the FE's surface)

Everything above is **system admin** (`/admin/*`, behind `SystemAdminGuard`). The tenant API is what the frontend calls — scoped to the caller's own tenant. Auth and DB scoping come entirely from the **signed JWT claim** (`tenantId`), never a URL slug: tenant routes carry no `:slug` param, and `SearchPathInterceptor` sets the Postgres `search_path` from the token. A tenant-A user cannot read tenant-B data.

Log in as the tenant admin created in §5.3 (use its one-time password). Keep it in a separate var so you don't clobber the system-admin `$TOKEN`:

```bash
TT=$(curl -sS -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "email": "admin@acme.test", "password": "<oneTimePassword>", "tenantSlug": "acme" }' \
  | jq -r .accessToken)
```

**Catalog reads** (any role). `crossed` is the headline — each tenant product crossed with `shared_catalog` competitor prices plus margin/variation/status. The grids accept `?store=<storeExternalId>` to project that store's price/cost (from `product_item`) over the globals; `GET /products/stores` lists the selector options (`storeId`, `storeExternalId`, `label`, `active`):

```bash
curl -sS "http://localhost:3000/products?page=1&perPage=50"   -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/crossed?perPage=50"  -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/stores"              -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/strategic-price"     -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/stock-metrics"       -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/active-ingredients"  -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/products/export"              -H "Authorization: Bearer $TT" -o catalog.csv
```

**Mutations** (operator/admin). Price and offer write-back hit the tenant's A7Pharma REST API *first*, then mirror locally — `409` unless the tenant has API creds configured (set them via `PUT /admin/tenants/:slug/integration` with `apiBaseUrl` + `apiKey`), `502` when the ERP write fails. Price changes are per-store: `storeId` is the uuid from `GET /products/stores` (`409` if that store is inactive):

```bash
curl -sS -X PATCH "http://localhost:3000/products/<ean>"       -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{"supplier":"New supplier","monitored":false}'
curl -sS -X POST  "http://localhost:3000/products/<ean>/price" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{"newPrice":19.90,"storeId":"<storeId>"}'
curl -sS -X POST  "http://localhost:3000/products/<ean>/offer" -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{"targetPrice":9.90,"cadernoId":123}'
curl -sS -X DELETE "http://localhost:3000/products/<ean>/offer" -H "Authorization: Bearer $TT"
```

> `cadernoId` is the A7Pharma *caderno de ofertas* id; it's stored on the offer (`tenant.offer_book.external_id`) so DELETE can clear the same caderno.

**Tenant config**. Variation-status thresholds drive the OK/ATENÇÃO/SUSPEITA classification; price-rounding rules + classifications round out the FE settings surface (writes are ADMIN):

```bash
curl -sS "http://localhost:3000/settings/variation-status"            -H "Authorization: Bearer $TT" | jq
curl -sS -X PATCH "http://localhost:3000/settings/variation-status"   -H "Authorization: Bearer $TT" -H 'Content-Type: application/json' -d '{"suspectAbove":60}'
curl -sS "http://localhost:3000/classifications/grouped"              -H "Authorization: Bearer $TT" | jq
curl -sS "http://localhost:3000/configurations/price-rounding"        -H "Authorization: Bearer $TT" | jq
```

The full request set with bodies and examples lives in the Postman collection (**Tenant — Catalog** + **Tenant — Config** folders).

---

## 6. Postman collection

Import [`postman/farmacore.postman_collection.json`](./postman/farmacore.postman_collection.json). The collection's `POST /auth/login` request has a Tests script that stores `accessToken` / `refreshToken` as collection variables, so the rest of the requests Just Work.

See [`postman/README.md`](./postman/README.md) for the per-plan sync rule (whenever you touch a controller, update the collection in the same commit).

---

## 7. Deploy to Fly.io

The deploy artifacts are in the repo — `fly.api.toml`, `fly.worker.toml`, `Dockerfile`, `.github/workflows/deploy.yml`. The cloud-side steps (account setup, secrets, first deploy, CI token) are runbook'd top-to-bottom in:

> 📘 [`docs/provisioning/first-deploy.md`](./docs/provisioning/first-deploy.md)

High-level summary:

1. Install `flyctl`, `neonctl`. Authenticate.
2. Create R2 token, Neon project, CloudAMQP instance.
3. `fly apps create farmacore-api`, `fly apps create farmacore-worker`.
4. `fly secrets set ...` on **both** apps. `JWT_SECRET` and `INTEGRATION_DB_KEY` must be identical between the two — the worker decrypts integration credentials with the same key.
5. `fly deploy --config fly.api.toml --app farmacore-api --remote-only`.
6. `fly deploy --config fly.worker.toml --app farmacore-worker --remote-only`.
7. `fly ssh console --app farmacore-api`, run `node dist/scripts/seed-system-admin.js`, save the password.
8. Add `FLY_API_TOKEN` to the GitHub repo secrets so the `Deploy` workflow can take over on every push to `main`.

Teardown: [`docs/provisioning/teardown.md`](./docs/provisioning/teardown.md).

---

## 8. Console links

Fill these in as the environments come up — they live here so anyone joining the project has them in one place.

### Production (Fly + vendors)

| Console | URL | Owner |
|---|---|---|
| Fly.io dashboard | _(to be filled — usually `https://fly.io/apps/farmacore-api` and `…/farmacore-worker`)_ | |
| Fly.io API logs (live) | `fly logs --app farmacore-api` | CLI |
| Fly.io worker logs | `fly logs --app farmacore-worker` | CLI |
| Neon project | _(to be filled — `https://console.neon.tech/app/projects/<project-id>`)_ | |
| CloudAMQP management UI | _(to be filled — `https://<host>/`)_ | |
| Cloudflare R2 bucket | _(to be filled — `https://dash.cloudflare.com/<account-id>/r2/default/buckets/<bucket>`)_ | |
| GitHub Actions (Deploy) | _(to be filled — `https://github.com/<org>/<repo>/actions/workflows/deploy.yml`)_ | |
| GitHub Actions (PR-preview) | _(to be filled — `https://github.com/<org>/<repo>/actions/workflows/pr-preview.yml`)_ | |
| Observability (OpenTelemetry vendor) | _(to be filled when Plan 07 lands)_ | |

### Local

| Console | URL |
|---|---|
| API | http://localhost:3000 |
| RabbitMQ management | http://localhost:15673 (`guest` / `guest`) |
| Postgres (farmacore) | `postgres://app:app@localhost:5433/app` |
| Postgres (ERP smoke) | `postgres://erp:erp@localhost:5435/erp` |

---

## 9. Common dev workflows

### Add a new tenant locally

```bash
npm run tenant:create <slug>     # creates schema + applies tenant migrations
```

Or via the admin API once the system admin exists:

```bash
curl -sS -X POST http://localhost:3000/admin/tenants \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{ "slug": "<slug>", "name": "<Name>", "adminEmail": "admin@<slug>.test" }'
```

The admin API path also seeds `tenant_competitor_origin` rows and creates an initial admin user.

### Run the integration smoke against the local ERP

The `erp` container auto-loads `docker/erp-seed/a7pharma-sample.sql` on first
boot — a referentially-coherent A7Pharma slice rooted at 10k embalagens (the
main integration entity) plus their produtos, estoque, custos, classificações,
cadernos de oferta and recebimentos, so the real entity set is queryable offline.

```bash
docker compose up -d erp           # initdb loads the A7Pharma sample
npx ts-node scripts/smoke-integration.ts acme
# → test: { ok: true }
```

> The seed only loads into a **fresh** erp volume. To reload after changing the
> sample: `docker compose rm -sf erp && docker volume rm farmacore_erpdata && docker compose up -d erp`.
>
> Regenerate the sample from a live ERP (defaults to the macfarma ngrok dev DB;
> override with `A7PHARMA_SOURCE_URL` / `A7PHARMA_SAMPLE_SIZE`):
> `npx ts-node scripts/dump-a7pharma-sample.ts`.

### Trigger a pipeline run locally

```bash
npx ts-node scripts/trigger-pipeline.ts acme     # publishes pipeline.start for acme
# Then inspect core.pipeline_run as in §5.6
```

### Regenerate migrations after entity changes

```bash
npm run migration:generate -- -n <MigrationName>
# adds a new file under migrations/core or migrations/tenant — review before committing
```

---

## 10. Troubleshooting

### Port already in use

```
Error: listen EADDRINUSE: address already in use 0.0.0.0:3000
```

Find and kill the stale process: `lsof -nP -i :3000 -t | xargs kill`.

### `PRECONDITION_FAILED ... 'x-dead-letter-exchange'`

RabbitMQ queue arguments are immutable — the broker refuses to redeclare an existing queue with different args. Locally this is usually a `NODE_ENV` switch; on deploys it happens when a release changes queue args (e.g. DLX wiring). Fix one of:

- Force `NODE_ENV=development` (e2e tests do this via `test/setup-e2e-env.ts`).
- `npm run queues:recreate` — deletes the main queues (empty ones only; `-- --force` drops messages) so the next boot redeclares them. Stop the worker first; see `docs/operator/runbook.md` → "Deploying queue-argument changes".
- Wipe RMQ: `docker compose down rabbitmq && docker compose up -d rabbitmq`.

### `/health` returns 401

Earlier builds before [the `@Public()` fix](./src/health/health.controller.ts) — pull latest. `/health` is intentionally public.

### `INTEGRATION_DB_KEY: must be 32 bytes (base64-encoded)`

The key in `.env` decodes to ≠32 bytes. Regenerate:

```bash
head -c 32 /dev/urandom | base64
```

Replace `INTEGRATION_DB_KEY` in `.env`. Restart the app.

### E2E test timeout exceeded

E2E tests wait on RabbitMQ. The default jest timeout is 5s; `test/jest-e2e.json` already bumps `testTimeout` to 30s, but if RMQ is cold-starting it can still time out. Bring the stack up first: `docker compose up -d`.

### Worker exits silently on first boot

Check `fly secrets list --app farmacore-worker` — if `INTEGRATION_DB_KEY` doesn't match the API's, every integration call fails to decrypt and the worker logs noisy errors. Resync both apps' keys.

---

## 11. Where things live

```
src/
├─ main.http.ts                 # API entry
├─ main.worker.ts               # worker entry
├─ app.module.ts                # API root module
├─ worker.module.ts             # worker root module
├─ admin/                       # admin API (plan 06)
├─ auth/                        # JWT + tenant auth (plan 02)
├─ common/                      # cross-cutting utilities + listeners (plan 09)
├─ config/                      # typed env + AppConfigService
├─ database/                    # entities + TypeORM data source
├─ health/                      # /health
├─ integration/                 # per-tenant ERP DataSource factory (plan 03)
│                                # entities/<vendor>/ — one folder per IntegrationOrigin (v1: a7pharma)
├─ interfaces/                  # DI tokens + interfaces
├─ pipeline/                    # 8 step consumers + cron + admin trigger (plan 05)
├─ presentation/                # interceptors + InternalLogger (plan 09)
├─ queue/                       # RMQ topology + publisher + retry (plan 04)
├─ tenant/                      # slug→schema mapping + TenantTransactionService + SearchPathInterceptor
└─ tenant-api/                  # tenant-user-facing API: catalog + config (plan 10)

migrations/                     # SQL migrations: core/, shared_catalog/, tenant/
scripts/                        # ops scripts (migrate-app, tenant:create, seed, …)
test/                           # e2e specs + jest config
postman/                        # API collection (kept in sync with plans/)
docs/provisioning/              # first-deploy + teardown runbooks
arc/                            # architecture docs
plans/                          # implementation plans (status in plans/README.md)
legacy-app/                     # previous implementation — reference only, not lift-and-shift
```
