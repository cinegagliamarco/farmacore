import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierColumnToProduct1766152745005 implements MigrationInterface {
  public name = 'AddSupplierColumnToProduct1766152745005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product" ADD COLUMN "supplier" VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "product" DROP COLUMN "supplier"
    `);
  }
}
