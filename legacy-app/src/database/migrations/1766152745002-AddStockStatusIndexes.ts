import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockStatusIndexes1766152745002 implements MigrationInterface {
  public name = 'AddStockStatusIndexes1766152745002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for product lookup by ean and origin
    await queryRunner.query(`
      CREATE INDEX "IDX_PRODUCT_EAN_ORIGIN" ON "product" ("ean", "origin")
    `);

    // Composite index for base_product_stock lookup
    await queryRunner.query(`
      CREATE INDEX "IDX_BASE_PRODUCT_STOCK_BASE_PRODUCT_QUANTITY" ON "base_product_stock" ("base_product_id", "quantity")
    `);

    // Index for base_product origin filter
    await queryRunner.query(`
      CREATE INDEX "IDX_BASE_PRODUCT_ORIGIN" ON "base_product" ("origin")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_PRODUCT_EAN_ORIGIN"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_STOCK_BASE_PRODUCT_QUANTITY"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_ORIGIN"`);
  }
}

