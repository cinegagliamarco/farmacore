import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeightColumnToProduct1754773653506 implements MigrationInterface {
  public name = 'AddWeightColumnToProduct1754773653506';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD "weight" numeric(10,3)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "weight"`);
  }
}