import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBaseProductMetricsColumns1765432100002 implements MigrationInterface {
  public name = 'AddBaseProductMetricsColumns1765432100002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Calculated metrics columns
    await queryRunner.query(`ALTER TABLE "base_product" ADD "margin" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "average_variation" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "status" character varying(20)`);

    // Add indexes for sortable columns
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_MARGIN" ON "base_product" ("margin")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_AVERAGE_VARIATION" ON "base_product" ("average_variation")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_STATUS" ON "base_product" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_STATUS"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_AVERAGE_VARIATION"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_MARGIN"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "status"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "average_variation"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "margin"`);
  }
}
