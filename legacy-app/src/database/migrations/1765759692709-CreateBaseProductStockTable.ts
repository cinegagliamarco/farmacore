import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBaseProductStockTable1765759692709 implements MigrationInterface {
  public name = 'CreateBaseProductStockTable1765759692709';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "base_product_stock" (
        "id" SERIAL NOT NULL,
        "base_product_id" integer NOT NULL,
        "quantity" integer NOT NULL DEFAULT 0,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BASE_PRODUCT_STOCK" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "base_product_stock"
      ADD CONSTRAINT "fk_base_product_stock"
      FOREIGN KEY ("base_product_id")
      REFERENCES "base_product"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_stock" DROP CONSTRAINT "fk_base_product_stock"`);
    await queryRunner.query(`DROP TABLE "base_product_stock"`);
  }
}
