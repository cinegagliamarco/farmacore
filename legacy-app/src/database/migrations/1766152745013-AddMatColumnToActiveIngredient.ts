import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMatColumnToActiveIngredient1766152745013 implements MigrationInterface {
  public name = 'AddMatColumnToActiveIngredient1766152745013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "active_ingredient" ADD "mat" NUMERIC(10, 2) NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "active_ingredient" DROP COLUMN "mat"`);
  }
}

