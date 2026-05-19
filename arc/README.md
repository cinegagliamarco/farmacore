# New App — Design Spec

**Date:** 2026-05-12
**Status:** Draft (pending review)

A multi-tenant NestJS backend extracted from the `farmacore/` prototype, with RabbitMQ-driven long-running routines, JWT auth, and a per-tenant configurable integration data source.

## Documents

Read in order:

| # | File | What it covers |
|---|---|---|
| 00 | [00-architecture.md](./00-architecture.md) | Overall architecture, cloud stack (Fly + Neon + CloudAMQP + R2), cost, AWS comparison |
| 01 | [01-database-schema.md](./01-database-schema.md) | Three DB roles (`app_meta`, `shared_catalog`, `tenant_<slug>`); simplified `base_product`; what's kept, moved, or dropped from the prototype |
| 02 | [02-queue-and-routines.md](./02-queue-and-routines.md) | RabbitMQ refactor of `daily-routines.cron.ts`; deletion of `import_process` |
| 03 | [03-auth-and-tenancy.md](./03-auth-and-tenancy.md) | JWT auth, tenant resolution, DB routing, onboarding/offboarding |
| 04 | [04-integration-data-source.md](./04-integration-data-source.md) | `integration_database_connection` table; replaces the hardcoded `INTEGRATION_DATABASE_URL` |
| 05 | [05-provisioning-tutorial.md](./05-provisioning-tutorial.md) | Step-by-step CLI + Terraform walkthrough to create every cloud resource from zero |

## Source Material

This spec assumes familiarity with the prototype in `farmacore/`. Key files referenced:

- `farmacore/src/cron/daily-routines.cron.ts` — refactored in **02**.
- `farmacore/src/database/entities/import-process.entity.ts` — deleted in **02**.
- `farmacore/src/database/entities/base-product.entity.ts` — simplified in **01**.
- `farmacore/src/database/integration.typeorm.data-source.ts` — refactored in **04**.

## Out of Scope

- Migrating the existing `farmacore/` code in place (this is a greenfield rewrite).
- Multi-region HA.
- Real-time streaming (Kafka, Kinesis).
- Headless browsing / Puppeteer.
