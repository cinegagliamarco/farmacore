import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-tenant scheduling table; rows were copied into
 * core.scheduling by core migration 1700000000032.
 */
export class DropScheduling1700000000006 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS scheduling`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS scheduling (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        cron_expression text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
  }
}
