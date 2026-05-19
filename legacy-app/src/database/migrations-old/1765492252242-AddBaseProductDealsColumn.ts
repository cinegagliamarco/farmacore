import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBaseProductDealsColumn1765492252242 implements MigrationInterface {
  name = 'AddBaseProductDealsColumn1765492252242';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD "deals" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "deals"`);
  }
}
