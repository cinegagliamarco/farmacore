import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-tenant status_settings table; rows were copied into
 * core.status_settings by core migration 1700000000034.
 */
export class DropStatusSettings1700000000008 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS status_settings`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS status_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);
  }
}
