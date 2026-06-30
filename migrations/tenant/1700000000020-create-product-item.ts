import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-store projection of price/cost for a tenant product. `store_id` is a
 * logical ref to core.tenant_store(id) (resolved in code — no cross-schema
 * FK). Unique on (product_id, store_id); the sync upserts on that pair.
 */
export class CreateProductItem1700000000020 implements MigrationInterface {
  public name = 'CreateProductItem1700000000020';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE product_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES product(id) ON DELETE CASCADE,
        store_id uuid NOT NULL,
        price numeric(12,2),
        price_offer numeric(12,2),
        cost numeric(12,4),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_PRODUCT_ITEM" ON product_item(product_id, store_id);
      CREATE INDEX "IX_PRODUCT_ITEM_STORE" ON product_item(store_id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS product_item`);
  }
}
