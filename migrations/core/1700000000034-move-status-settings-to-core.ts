import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves status_settings (per-tenant threshold config read by
 * calc-base-product-metrics) into core. Creates core.status_settings and
 * copies rows out of every tenant schema; the per-tenant table is dropped
 * by tenant migration 1700000000008.
 */
export class MoveStatusSettingsToCore1700000000034
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.status_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_STATUS_SETTINGS_TENANT" ON core.status_settings(tenant_id);
    `);

    await q.query(`
      DO $$
      DECLARE t RECORD;
      BEGIN
        FOR t IN SELECT id, schema_name FROM core.tenant LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schema_name AND table_name = 'status_settings'
          ) THEN
            EXECUTE format(
              'INSERT INTO core.status_settings
                 (id, tenant_id, settings, created_at, updated_at, deleted_at)
               SELECT id, %L, settings, created_at, updated_at, deleted_at
                 FROM %I.status_settings
               ON CONFLICT (id) DO NOTHING',
              t.id, t.schema_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.status_settings`);
  }
}
