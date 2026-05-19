import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewBaseProductColumns1746822123105 implements MigrationInterface {
  public name = 'AddNewBaseProductColumns1746822123105';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD "average_unit_cost" numeric(10,2)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "unit_sale_price" numeric(10,2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "unit_sale_price"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "average_unit_cost"`);
  }
}
