# Postman collection

`farmacore.postman_collection.json` is the canonical Postman v2.1 collection for the Farmacore HTTP API. It is hand-curated and kept in sync with `plans/` — every plan that introduces, renames, or removes a controller route must update this file in the same commit.

## Sync rule

For each plan that touches `*.controller.ts`:

1. Add / update the request in the matching folder (`Health`, `Auth`, future `Admin`, etc.).
2. Set `auth` per route — public routes use `{ "type": "noauth" }`; protected routes inherit collection-level Bearer.
3. Reference the controller file in the request `description` (`Plan 02 — src/auth/auth.controller.ts`).
4. If the request returns a token (login, refresh), add a Tests script that stores it as a collection variable.

## Variables

| key            | default                  | purpose                                          |
| -------------- | ------------------------ | ------------------------------------------------ |
| `baseUrl`      | `http://localhost:3000`  | API base. Override for staging/prod.             |
| `tenantSlug`   | `acme`                   | Default tenant slug used in tenant-scoped routes. |
| `accessToken`  | (set by login/refresh)   | JWT bearer; auto-populated by the login test.    |
| `refreshToken` | (set by login/refresh)   | Refresh token; auto-populated by the login test. |

## Local quickstart

```bash
docker compose up -d
npm run migration:run:app
npm run tenant:create acme || true
SEED_ADMIN_PASSWORD=devpassword-please-change npm run seed:system-admin
npm run start:dev
```

Then import `postman/farmacore.postman_collection.json` into Postman and run:

1. `Auth → POST /auth/login` (defaults log in as the system admin against tenant `system`)
2. `Auth → GET /auth/me` (should return `{ sub, tenantId: 'system', role: 'admin' }`)

## Coverage

Currently covers:

- `GET /health` (Plan 00 / 07)
- Auth (Plan 02): `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- Admin tenants (Plan 06): `POST /admin/tenants`, `GET /admin/tenants`, `GET /admin/tenants/:slug`, `PATCH /admin/tenants/:slug/status`, `DELETE /admin/tenants/:slug`
- Admin integration (Plan 06): `PUT /admin/tenants/:slug/integration`, `POST /admin/tenants/:slug/integration/test`, `DELETE /admin/tenants/:slug/integration`
- Admin competitor origins (Plan 06): `PUT /admin/tenants/:slug/competitor-origins`
- Admin pipeline (Plan 06): `POST /admin/tenants/:slug/pipeline/start`
- Admin DLQ (Plan 06): `GET /admin/dlq/:step`, `POST /admin/dlq/:step/replay`

Pending plans that will add requests:

- **Plan 07** — extended health/observability endpoints (readiness, metrics) if applicable
