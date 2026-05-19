import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductActiveColumn1765432100003 implements MigrationInterface {
  name = 'AddProductActiveColumn1765432100003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD "active" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "price" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "average_unit_cost" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "unit_sale_price" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "cost" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "price_for_offer" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "margin" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "average_variation" SET DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "weight" SET DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "weight" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "average_variation" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "margin" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "price_for_offer" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "cost" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "unit_sale_price" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "average_unit_cost" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "price" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "active"`);
  }
}
