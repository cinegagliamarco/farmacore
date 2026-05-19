import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubsidiaryColumnsToBaseProductStock1766017498875 implements MigrationInterface {
  public name = 'AddSubsidiaryColumnsToBaseProductStock1766017498875';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for subsidiary_name
    await queryRunner.query(`
      CREATE TYPE "subsidiary_name" AS ENUM ('LOJA 1', 'LOJA 2', 'LOJA 3')
    `);

    // Add subsidiary_id column
    await queryRunner.query(`
      ALTER TABLE "base_product_stock"
      ADD COLUMN "subsidiary_id" integer
    `);

    // Add subsidiary_name column
    await queryRunner.query(`
      ALTER TABLE "base_product_stock"
      ADD COLUMN "subsidiary_name" "subsidiary_name"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_stock" DROP COLUMN "subsidiary_name"`);
    await queryRunner.query(`ALTER TABLE "base_product_stock" DROP COLUMN "subsidiary_id"`);
    await queryRunner.query(`DROP TYPE "subsidiary_name"`);
  }
}
