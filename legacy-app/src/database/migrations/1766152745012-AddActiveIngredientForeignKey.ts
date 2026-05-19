import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveIngredientForeignKey1766152745012 implements MigrationInterface {
  public name = 'AddActiveIngredientForeignKey1766152745012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing index if it exists
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ACTIVE_INGREDIENT_NAME"`);

    // Create unique constraint only if it doesn't already exist
    const constraintExists = await queryRunner.query(`
      SELECT 1 FROM pg_constraint WHERE conname = 'UQ_ACTIVE_INGREDIENT_NAME'
    `);
    if (constraintExists.length === 0) {
      await queryRunner.query(`ALTER TABLE "active_ingredient" ADD CONSTRAINT "UQ_ACTIVE_INGREDIENT_NAME" UNIQUE ("name")`);
    }

    // Add foreign key constraint from base_product.active_ingredient to active_ingredient.name
    await queryRunner.query(`
      ALTER TABLE "base_product"
      ADD CONSTRAINT "fk_base_product_active_ingredient"
      FOREIGN KEY ("active_ingredient")
      REFERENCES "active_ingredient" ("name")
      ON DELETE SET NULL
      ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the foreign key constraint
    await queryRunner.query(`ALTER TABLE "base_product" DROP CONSTRAINT "fk_base_product_active_ingredient"`);

    // Remove the unique constraint and recreate the index
    await queryRunner.query(`ALTER TABLE "active_ingredient" DROP CONSTRAINT "UQ_ACTIVE_INGREDIENT_NAME"`);
    await queryRunner.query(`CREATE INDEX "IDX_ACTIVE_INGREDIENT_NAME" ON "active_ingredient" ("name")`);
  }
}

