import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Competitor stock was removed from the project. Drop the cross-tenant
 * competitor stock snapshots table. (Tenant ERP stock lives in each
 * tenant schema's own product_stock and is unaffected.)
 */
export class DropProductStock1700000000002 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS shared_catalog.product_stock`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE shared_catalog.product_stock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES shared_catalog.product(id) ON DELETE CASCADE,
        quantity int NOT NULL,
        captured_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRODUCT_STOCK_PRODUCT_CAPTURED" ON shared_catalog.product_stock(product_id, captured_at);
    `);
  }
}
