import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves tenant_competitor_origin (per-tenant scrape config) out of each
 * tenant schema into core, next to tenant + integration_database_connection.
 *
 * Creates core.tenant_competitor_origin (tenant_id uuid FK) and copies
 * existing rows from every tenant schema. The per-tenant tables are
 * dropped separately by the tenant migration (1700000000004), which runs
 * after this one — so data is copied before anything is removed.
 */
export class MoveCompetitorOriginToCore1700000000030
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.tenant_competitor_origin (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        origin text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_core_tco_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE UNIQUE INDEX "UQ_TENANT_COMPETITOR_ORIGIN"
        ON core.tenant_competitor_origin(tenant_id, origin);
    `);

    // Copy existing per-tenant rows into core, keyed by the tenant uuid.
    await q.query(`
      DO $$
      DECLARE t RECORD;
      BEGIN
        FOR t IN SELECT id, schema_name FROM core.tenant LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schema_name
              AND table_name = 'tenant_competitor_origin'
          ) THEN
            EXECUTE format(
              'INSERT INTO core.tenant_competitor_origin
                 (tenant_id, origin, enabled, priority, config, created_at, updated_at, deleted_at)
               SELECT %L, origin, enabled, priority, config, created_at, updated_at, deleted_at
                 FROM %I.tenant_competitor_origin
               ON CONFLICT (tenant_id, origin) DO NOTHING',
              t.id, t.schema_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.tenant_competitor_origin`);
  }
}
