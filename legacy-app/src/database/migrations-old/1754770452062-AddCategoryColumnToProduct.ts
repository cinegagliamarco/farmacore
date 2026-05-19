import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryColumnToProduct1754770452062 implements MigrationInterface {
  public name = 'AddCategoryColumnToProduct1754770452062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD "category" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "category"`);
  }
}