import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves price_rounding_rule + price_rounding_decimal_range into core.
 * They share an FK (range.rule_id -> rule.id), so: create rule first,
 * then range; copy preserving the original ids so the FK survives the
 * move (uuids are globally unique, no cross-tenant collision). The
 * per-tenant tables are dropped by tenant migration 1700000000007.
 */
export class MovePriceRoundingToCore1700000000033
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE core.price_rounding_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRICE_ROUNDING_RULE_TENANT" ON core.price_rounding_rule(tenant_id);

      CREATE TABLE core.price_rounding_decimal_range (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        rule_id uuid NOT NULL REFERENCES core.price_rounding_rule(id) ON DELETE CASCADE,
        min_decimal numeric(5,2) NOT NULL,
        max_decimal numeric(5,2) NOT NULL,
        target_decimal numeric(5,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_DECIMAL_RANGE_RULE" ON core.price_rounding_decimal_range(rule_id);
    `);

    await q.query(`
      DO $$
      DECLARE t RECORD;
      BEGIN
        FOR t IN SELECT id, schema_name FROM core.tenant LOOP
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = t.schema_name AND table_name = 'price_rounding_rule'
          ) THEN
            EXECUTE format(
              'INSERT INTO core.price_rounding_rule
                 (id, tenant_id, name, enabled, priority, created_at, updated_at, deleted_at)
               SELECT id, %L, name, enabled, priority, created_at, updated_at, deleted_at
                 FROM %I.price_rounding_rule
               ON CONFLICT (id) DO NOTHING',
              t.id, t.schema_name
            );
            EXECUTE format(
              'INSERT INTO core.price_rounding_decimal_range
                 (id, tenant_id, rule_id, min_decimal, max_decimal, target_decimal, created_at, updated_at, deleted_at)
               SELECT id, %L, rule_id, min_decimal, max_decimal, target_decimal, created_at, updated_at, deleted_at
                 FROM %I.price_rounding_decimal_range
               ON CONFLICT (id) DO NOTHING',
              t.id, t.schema_name
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_decimal_range`);
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_rule`);
  }
}
