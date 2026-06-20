import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reshape price-rounding to the pricy-shelf model: a PRICE BAND
 * (price_rounding_range: price_min/price_max) owning DECIMAL BUCKETS
 * (price_rounding_rule: decimal_min/decimal_max/round_to). Replaces the
 * previous name/enabled/priority "rule" parent that had no price band.
 *
 * The feature was unreleased config (no rows in any tenant), so the old
 * tables are dropped and recreated rather than data-migrated.
 */
export class ReshapePriceRoundingToPriceBand1700000000036
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_decimal_range`);
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_rule`);

    await q.query(`
      CREATE TABLE core.price_rounding_range (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        price_min numeric(10,2) NOT NULL,
        price_max numeric(10,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRICE_ROUNDING_RANGE_TENANT" ON core.price_rounding_range(tenant_id);

      CREATE TABLE core.price_rounding_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid NOT NULL REFERENCES core.tenant(id) ON DELETE CASCADE,
        range_id uuid NOT NULL REFERENCES core.price_rounding_range(id) ON DELETE CASCADE,
        decimal_min numeric(4,2) NOT NULL,
        decimal_max numeric(4,2) NOT NULL,
        round_to numeric(4,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRICE_ROUNDING_RULE_RANGE" ON core.price_rounding_rule(range_id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_rule`);
    await q.query(`DROP TABLE IF EXISTS core.price_rounding_range`);

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
  }
}
