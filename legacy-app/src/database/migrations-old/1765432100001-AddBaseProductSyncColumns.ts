import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBaseProductSyncColumns1765432100001 implements MigrationInterface {
  public name = 'AddBaseProductSyncColumns1765432100001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Columns synchronized from integration database
    await queryRunner.query(`ALTER TABLE "base_product" ADD "supplier" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "classification" character varying(500)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "cost" numeric(15,4)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "price_for_offer" numeric(15,4)`);

    // Add indexes for sortable columns
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_NAME" ON "base_product" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_EAN" ON "base_product" ("ean")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_SUPPLIER" ON "base_product" ("supplier")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_CLASSIFICATION" ON "base_product" ("classification")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_BOOK" ON "base_product" ("book")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_COST" ON "base_product" ("cost")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_PRICE" ON "base_product" ("price")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_PRICE_FOR_OFFER" ON "base_product" ("price_for_offer")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_PRICE_FOR_OFFER"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_PRICE"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_COST"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_BOOK"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_CLASSIFICATION"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_SUPPLIER"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_EAN"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_NAME"`);

    // Drop columns
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "price_for_offer"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "cost"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "classification"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "supplier"`);
  }
}
