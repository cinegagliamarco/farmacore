import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-tenant tenant_subsidiary table; rows were copied into
 * core.tenant_subsidiary by core migration 1700000000031 (which runs
 * before per-tenant migrations on deploy).
 */
export class DropTenantSubsidiary1700000000005 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS tenant_subsidiary`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS tenant_subsidiary (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        external_id bigint NOT NULL,
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_TENANT_SUBSIDIARY_EXTERNAL_ID"
        ON tenant_subsidiary(external_id);
    `);
  }
}
