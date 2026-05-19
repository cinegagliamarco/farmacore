import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExternalIdToActiveIngredient1766152745004 implements MigrationInterface {
  public name = 'AddExternalIdToActiveIngredient1766152745004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing non-unique index on name
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ACTIVE_INGREDIENT_NAME"`);

    // Add unique constraint on name
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      ADD CONSTRAINT "UQ_ACTIVE_INGREDIENT_NAME" UNIQUE ("name")
    `);

    // Add external_id column
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      ADD COLUMN "external_id" bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove external_id column
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      DROP COLUMN "external_id"
    `);

    // Remove unique constraint on name
    await queryRunner.query(`
      ALTER TABLE "active_ingredient"
      DROP CONSTRAINT "UQ_ACTIVE_INGREDIENT_NAME"
    `);

    // Recreate the original non-unique index on name
    await queryRunner.query(`CREATE INDEX "IDX_ACTIVE_INGREDIENT_NAME" ON "active_ingredient" ("name")`);
  }
}
