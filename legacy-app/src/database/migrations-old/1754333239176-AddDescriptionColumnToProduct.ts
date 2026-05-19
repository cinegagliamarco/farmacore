import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDescriptionColumnToProduct1754333239176 implements MigrationInterface {
  public name = 'AddDescriptionColumnToProduct1754333239176';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD "description" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "description"`);
  }
}
