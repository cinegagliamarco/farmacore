import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptDateColumnToBaseProduct1766152745016 implements MigrationInterface {
  public name = 'AddReceiptDateColumnToBaseProduct1766152745016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" ADD COLUMN "receipt_date" VARCHAR(10)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" DROP COLUMN "receipt_date"
    `);
  }
}

