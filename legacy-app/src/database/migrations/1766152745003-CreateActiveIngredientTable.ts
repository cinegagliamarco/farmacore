import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateActiveIngredientTable1766152745003 implements MigrationInterface {
  public name = 'CreateActiveIngredientTable1766152745003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "active_ingredient" (
        "id" SERIAL NOT NULL,
        "name" character varying(255) NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ACTIVE_INGREDIENT" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_ACTIVE_INGREDIENT_NAME" ON "active_ingredient" ("name")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_ACTIVE_INGREDIENT_NAME"`);
    await queryRunner.query(`DROP TABLE "active_ingredient"`);
  }
}

