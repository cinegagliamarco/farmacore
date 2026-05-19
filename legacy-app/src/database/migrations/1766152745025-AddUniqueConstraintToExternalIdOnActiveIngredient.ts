import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueConstraintToExternalIdOnActiveIngredient1766152745025 implements MigrationInterface {
  public name = 'AddUniqueConstraintToExternalIdOnActiveIngredient1766152745025';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      ADD CONSTRAINT "UQ_ACTIVE_INGREDIENT_EXTERNAL_ID" UNIQUE ("external_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      DROP CONSTRAINT "UQ_ACTIVE_INGREDIENT_EXTERNAL_ID"
    `);
  }
}
