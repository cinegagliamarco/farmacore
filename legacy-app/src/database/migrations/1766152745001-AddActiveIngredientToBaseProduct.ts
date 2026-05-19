import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddActiveIngredientToBaseProduct1766152745001 implements MigrationInterface {
  public name = 'AddActiveIngredientToBaseProduct1766152745001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" ADD COLUMN "active_ingredient" VARCHAR(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "base_product" DROP COLUMN "active_ingredient"
    `);
  }
}
