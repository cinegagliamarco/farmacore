import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dead code removal: product_override was scaffolded for a per-(ean,
 * origin) override feature that was never wired up (no repo, service, or
 * query reads it; monitoring lives on tenant.product.monitored). Drop it.
 */
export class DropProductOverride1700000000018 implements MigrationInterface {
  public name = 'DropProductOverride1700000000018';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS product_override`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE product_override (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        origin text NOT NULL,
        monitored boolean NOT NULL DEFAULT false,
        notes text,
        overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_PRODUCT_OVERRIDE_EAN_ORIGIN"
        ON product_override(ean, origin);
      CREATE INDEX "IX_PRODUCT_OVERRIDE_EAN" ON product_override(ean);
    `);
  }
}
