import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves scheduling (per-tenant cron definitions) into core. Creates
 * core.scheduling and copies rows out of every tenant schema; the
 * per-tenant table is dropped by tenant migration 1700000000006.
 */
export class MoveSchedulingToCore1700000000032 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.scheduling (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        name text NOT NULL,
        cron_expression text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_SCHEDULING_TENANT" ON core.scheduling(tenant_id);
    `);

    await q.query(`
      DO $$
      DECLARE t RECORD;
      BEGIN
        FOR t IN SELECT id, schema_name FROM core.tenant LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schema_name AND table_name = 'scheduling'
          ) THEN
            EXECUTE format(
              'INSERT INTO core.scheduling
                 (tenant_id, name, cron_expression, enabled, payload, created_at, updated_at, deleted_at)
               SELECT %L, name, cron_expression, enabled, payload, created_at, updated_at, deleted_at
                 FROM %I.scheduling',
              t.id, t.schema_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.scheduling`);
  }
}
