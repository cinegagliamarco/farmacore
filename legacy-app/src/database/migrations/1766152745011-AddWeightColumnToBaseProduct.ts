import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeightColumnToBaseProduct1766152745011 implements MigrationInterface {
  public name = 'AddWeightColumnToBaseProduct1766152745011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" ADD COLUMN "weight" NUMERIC(10, 3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" DROP COLUMN "weight"
    `);
  }
}
