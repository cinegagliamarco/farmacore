import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateBaseProductClassification1766152745023 implements MigrationInterface {
  public name = 'MigrateBaseProductClassification1766152745023';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add classification_id column to base_product
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "classification_id" integer`);

    // Update base_product with classification_id references
    await queryRunner.query(`
      UPDATE "base_product" bp
      SET "classification_id" = c.id
      FROM "classification" c
      WHERE bp.classification = c.name
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "base_product"
      ADD CONSTRAINT "fk_base_product_classification"
      FOREIGN KEY ("classification_id")
      REFERENCES "classification"("id")
      ON DELETE SET NULL
    `);

    // Create index on classification_id
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_CLASSIFICATION_ID" ON "base_product" ("classification_id")`);

    // Drop the old classification column and its index
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_CLASSIFICATION"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "classification"`);

    // Drop unused indexes from base_product
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_SUPPLIER"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_BOOK"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_COST"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_PRICE"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_MARGIN"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_AVERAGE_VARIATION"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_EXTERNAL_ID"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-create dropped indexes
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_EXTERNAL_ID" ON "base_product" ("external_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_AVERAGE_VARIATION" ON "base_product" ("average_variation")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_MARGIN" ON "base_product" ("margin")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_PRICE" ON "base_product" ("price")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_COST" ON "base_product" ("cost")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_BOOK" ON "base_product" ("book")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_SUPPLIER" ON "base_product" ("supplier")`);

    // Re-add classification column to base_product
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "classification" character varying(500)`);

    // Restore classification data from classification table
    await queryRunner.query(`
      UPDATE "base_product" bp
      SET "classification" = c.name
      FROM "classification" c
      WHERE bp.classification_id = c.id
    `);

    // Re-create the old index
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_CLASSIFICATION" ON "base_product" ("classification")`);

    // Drop foreign key and classification_id column
    await queryRunner.query(`ALTER TABLE "base_product" DROP CONSTRAINT IF EXISTS "fk_base_product_classification"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_CLASSIFICATION_ID"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "classification_id"`);
  }
}
