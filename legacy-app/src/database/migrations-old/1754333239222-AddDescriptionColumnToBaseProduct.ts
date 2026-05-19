import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDescriptionColumnToBaseProduct1754333239222 implements MigrationInterface {
  public name = 'AddDescriptionColumnToBaseProduct1754333239222';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD "description" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "description"`);
  }
}
