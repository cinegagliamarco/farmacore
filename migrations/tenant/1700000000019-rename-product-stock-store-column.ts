import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames product_stock.subsidiary_external_id -> store_external_id (and its
 * unique index) to standardize on "store". Runs per tenant schema. Pure rename;
 * data is preserved.
 */
export class RenameProductStockStoreColumn1700000000019
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE IF EXISTS product_stock
         RENAME COLUMN subsidiary_external_id TO store_external_id`,
    );
    await q.query(
      `ALTER INDEX IF EXISTS "UQ_PRODUCT_STOCK_EAN_SUBSIDIARY"
         RENAME TO "UQ_PRODUCT_STOCK_EAN_STORE"`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER INDEX IF EXISTS "UQ_PRODUCT_STOCK_EAN_STORE"
         RENAME TO "UQ_PRODUCT_STOCK_EAN_SUBSIDIARY"`,
    );
    await q.query(
      `ALTER TABLE IF EXISTS product_stock
         RENAME COLUMN store_external_id TO subsidiary_external_id`,
    );
  }
}
