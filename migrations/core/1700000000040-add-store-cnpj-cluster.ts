import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores & clusters foundation. Adds `cnpj` and `cluster_id` to
 * core.tenant_store, and creates core.store_cluster. The sync upserts on
 * the stable (tenant_id, external_id) key and backfills cnpj; the unique
 * cnpj index is PARTIAL (WHERE cnpj IS NOT NULL) so legacy rows (NULL cnpj
 * until the first sync) don't collide and it still guards real duplicates.
 */
export class AddStoreCnpjCluster1700000000040 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.store_cluster (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_STORE_CLUSTER_TENANT" ON core.store_cluster(tenant_id);
    `);

    await q.query(`
      ALTER TABLE core.tenant_store
        ADD COLUMN cnpj text,
        ADD COLUMN cluster_id uuid
          REFERENCES core.store_cluster(id) ON DELETE SET NULL;
    `);

    await q.query(`
      CREATE UNIQUE INDEX "UQ_TENANT_STORE_CNPJ"
        ON core.tenant_store(tenant_id, cnpj)
        WHERE cnpj IS NOT NULL;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS core."UQ_TENANT_STORE_CNPJ"`);
    await q.query(`
      ALTER TABLE core.tenant_store
        DROP COLUMN IF EXISTS cluster_id,
        DROP COLUMN IF EXISTS cnpj;
    `);
    await q.query(`DROP TABLE IF EXISTS core.store_cluster`);
  }
}
