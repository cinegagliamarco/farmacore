import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dead code removal: core.scheduling (per-tenant cron definitions) was
 * moved to core (migration 32) but never wired to an executor — no cron,
 * service, or query reads it. Drop it. (Note: the live pricing scheduler
 * uses the separate tenant `pricing_schedule` table, not this one.)
 */
export class DropScheduling1700000000038 implements MigrationInterface {
  public name = 'DropScheduling1700000000038';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.scheduling`);
  }

  public async down(q: QueryRunner): Promise<void> {
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
  }
}
