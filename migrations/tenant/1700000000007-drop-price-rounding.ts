import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-tenant price_rounding tables (child range first, then
 * parent rule); rows were copied into core by migration 1700000000033.
 */
export class DropPriceRounding1700000000007 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS price_rounding_decimal_range`);
    await q.query(`DROP TABLE IF EXISTS price_rounding_rule`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS price_rounding_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS price_rounding_decimal_range (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES price_rounding_rule(id) ON DELETE CASCADE,
        min_decimal numeric(5,2) NOT NULL,
        max_decimal numeric(5,2) NOT NULL,
        target_decimal numeric(5,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS "IX_DECIMAL_RANGE_RULE" ON price_rounding_decimal_range(rule_id);
    `);
  }
}
