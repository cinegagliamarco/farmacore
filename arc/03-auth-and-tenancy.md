# 03 — Auth & Tenancy

**Date:** 2026-05-12
**Status:** Draft

## 1. Purpose

Define how users authenticate, how a request resolves to a tenant, and how the app routes queries to the correct tenant schema via `search_path`.

## 2. Auth Model

### Choice: app-issued JWT, symmetric for v1

- The API service issues JWTs on `POST /auth/login` (email + password).
- Tokens are signed with **HS256** using a single secret (`JWT_SECRET` in Fly secrets) for v1. Move to RS256/JWKS only if/when third-party verifiers appear.
- Token TTL: 1 hour. Refresh token TTL: 14 days (stored hashed in `app_meta.refresh_token`).
- No external IdP, no OAuth, no SSO for v1 — explicitly deferred.

### Claims

```json
{
  "sub": "<user_id>",
  "tenantId": "acme",
  "role": "admin" | "operator" | "viewer",
  "iat": ...,
  "exp": ...
}
```

- `tenantId` is the tenant slug; immutable per user.
- `role` gates endpoint access via NestJS guards. Three roles for v1, granular permissions deferred.

### Library

- `@nestjs/passport` + `passport-jwt` — already standard in the NestJS ecosystem and used in the existing `license-verification` repo.
- Password hashing: `argon2id`.

## 3. User Model

Stored in `app_meta.user`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `tenant_id` | `text` | FK → `app_meta.tenant.slug` |
| `email` | `citext` | Unique across `(tenant_id, email)` |
| `password_hash` | `text` | argon2id |
| `role` | `enum('admin','operator','viewer')` | |
| `status` | `enum('active','disabled')` | |
| `created_at`, `updated_at` | `timestamptz` | |

**One user belongs to exactly one tenant in v1.** Multi-tenant users (e.g., consultants) can be modeled later via a join table without breaking existing tokens.

## 4. Tenant Model

Stored in `app_meta.tenant`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `slug` | `text` | Unique, lowercase, kebab-case, **user-chosen at onboarding** |
| `name` | `text` | Display name |
| `schema_name` | `text` | Postgres schema name (`tenant_<slug>`) — unique |
| `status` | `enum('active','paused','suspended')` | `paused` keeps DB online but workers ack-and-skip; `suspended` blocks API access |
| `created_at` | `timestamptz` | |

### Slug rules

- 3–32 chars, `[a-z0-9-]`, must start with a letter.
- Reserved words rejected (`admin`, `api`, `app`, `meta`, `shared`, `system`, `www`).
- **Decision:** user-chosen at onboarding (gives nicer JWT claims and DB names). System rejects collisions.

## 5. Request → Tenant Resolution

Order of precedence on every authenticated request:

1. `tenantId` claim in the verified JWT.
2. Reject if missing.

That's it. No subdomain routing, no header overrides for v1 — keep one source of truth.

### NestJS wiring

- A global `JwtAuthGuard` enforces presence and validity of the token.
- A request-scoped `TenantContext` provider extracts `tenantId` (and the corresponding `schemaName`) from the JWT and exposes:
  - `tenantId: string`
  - `schemaName: string` — `tenant_<slug>`
  - `appDataSource: DataSource` — the single shared TypeORM `DataSource` (all schemas live in one Neon DB)
  - `integrationDataSource: DataSource | null` — looked up per request (see `04-integration-data-source.md`); null when the tenant has no ERP source configured
- A NestJS interceptor wraps each request in a TypeORM transaction and issues `SET LOCAL search_path = <schemaName>, shared_catalog, public;` as the first statement. Workers (queue consumers) do the same on each message handler.
- Repositories run against `appDataSource` and rely on `search_path` for schema resolution — no per-tenant DataSource juggling.

### DataSource setup

A single application `DataSource` for the whole Neon DB:

- Connects through the Neon **PgBouncer pooler endpoint**.
- Pool size sized for total concurrent requests across all tenants (e.g. 20–50, tuned in load testing).
- Single set of TypeORM entities, each declaring its `schema` (either `'app_meta'`, `'shared_catalog'`, or — for tenant tables — left unset so it resolves via `search_path`).
- No LRU cache, no per-tenant connection pools — that complexity is gone with the schema-per-tenant model.

## 6. Tenant Onboarding Flow

`POST /admin/tenants` (admin-only, requires a token with `role=admin` against the **system** tenant — see §9):

1. Validate slug.
2. Insert `app_meta.tenant` row with `status=active`.
3. Run `CREATE SCHEMA tenant_<slug>;` against the app DB.
4. Run tenant migrations against the new schema (synchronously for the onboarding call; failure rolls the tenant row to `status=suspended` and surfaces the error).
5. Seed `tenant_<slug>.tenant_competitor_origin` with one row per known origin, **all `enabled=false`**. Admins enable the ones they want via `PUT /admin/tenants/:slug/competitor-origins`.
6. Create an initial `admin` user for the tenant.
7. Return the slug, the admin user's one-time password reset link.

If step 3 or 4 fails, the tenant row stays at `status=suspended` and the operator must re-run migrations manually or delete the tenant and retry.

## 7. Tenant Offboarding

`DELETE /admin/tenants/:slug`:

1. Set `tenant.status=suspended` (immediate effect on API auth).
2. Export the tenant schema to R2 (`s3://app-prod-backups/tenant/<slug>/<timestamp>.dump`) via `pg_dump --schema=tenant_<slug>`.
3. Wait 30 days (configurable).
4. `DROP SCHEMA tenant_<slug> CASCADE;` and delete the `tenant` row.

The 30-day grace period is enforced by a scheduled job, not by the delete endpoint itself.

## 8. Role-Based Access (v1)

| Role | Permissions |
|---|---|
| `admin` | Full CRUD within the tenant; can create/disable users in the tenant |
| `operator` | Read all; trigger pipeline runs, edit pricing rules |
| `viewer` | Read-only |

Implemented via a NestJS `@Roles(...)` decorator + guard. Endpoint-level only for v1; row-level permissions deferred.

## 9. The "System" Tenant

A reserved tenant with slug `system` exists from day one. It owns:

- The cross-cutting admin endpoints (tenant management, DLQ inspection, etc.).
- The migration runner job's audit rows.

Tokens issued for the `system` tenant cannot access tenant-scoped endpoints; they only see admin routes. This keeps multi-tenant routing logic clean (everything is "some tenant").

## 10. Open Questions

- Email verification on user creation — v1 ships without it; add when a public signup flow exists.
- Password reset flow — needs a transactional email provider (Postmark, Resend). **Decision: defer to post-v1 unless needed for onboarding.** For v1, password resets are issued by admins via a one-time link.
- Multi-tenant users (one human, many tenants) — modeled as a `user_tenant` join later; not needed for v1.

## 11. Success Criteria

- `POST /auth/login` returns a JWT containing `sub`, `tenantId`, `role`.
- Authenticated request to `/products` resolves to the correct tenant schema via `search_path` based on the JWT's `tenantId` claim; cross-tenant access is impossible.
- Tenant onboarding creates a new schema, runs migrations, and provisions an admin user end-to-end in a single API call.
- Suspending a tenant immediately blocks API access without restart.
- A query that joins `shared_catalog.base_product` with a tenant-scoped table returns only that tenant's data.
