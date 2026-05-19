import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMatAndOriginToBaseProduct1766017498892 implements MigrationInterface {
  public name = 'AddMatAndOriginToBaseProduct1766017498892';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "base_product_origin_enum" AS ENUM ('ERP', 'CSV')
    `);

    await queryRunner.query(`
      ALTER TABLE "base_product" ADD COLUMN "origin" "base_product_origin_enum"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_ORIGIN"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "origin"`);
    await queryRunner.query(`DROP TYPE "base_product_origin_enum"`);
  }
}
