import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeasureColumnsToProductAndBaseProduct1766152745039 implements MigrationInterface {
  public name = 'AddMeasureColumnsToProductAndBaseProduct1766152745039';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "cubic_weight" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "height" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "length" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "width" numeric(10,4)`);

    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "cubic_weight" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "height" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "length" numeric(10,4)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "width" numeric(10,4)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "width"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "length"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "height"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "cubic_weight"`);

    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "width"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "length"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "height"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "cubic_weight"`);
  }
}
