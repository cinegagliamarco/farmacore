import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves tenant_subsidiary (per-tenant subsidiary label config) into core.
 * Creates core.tenant_subsidiary and copies rows out of every tenant
 * schema; the per-tenant table is dropped by tenant migration 1700000000005,
 * which runs after this one on deploy.
 */
export class MoveTenantSubsidiaryToCore1700000000031
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.tenant_subsidiary (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        external_id bigint NOT NULL,
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_SUBSIDIARY_EXTERNAL_ID"
        ON core.tenant_subsidiary(tenant_id, external_id);
    `);

    await q.query(`
      DO $$
      DECLARE t RECORD;
      BEGIN
        FOR t IN SELECT id, schema_name FROM core.tenant LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schema_name AND table_name = 'tenant_subsidiary'
          ) THEN
            EXECUTE format(
              'INSERT INTO core.tenant_subsidiary
                 (tenant_id, external_id, name, active, created_at, updated_at, deleted_at)
               SELECT %L, external_id, name, active, created_at, updated_at, deleted_at
                 FROM %I.tenant_subsidiary
               ON CONFLICT (tenant_id, external_id) DO NOTHING',
              t.id, t.schema_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.tenant_subsidiary`);
  }
}
