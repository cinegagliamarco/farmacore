import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductStockTable1765759692706 implements MigrationInterface {
  public name = 'CreateProductStockTable1765759692706';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_stock" (
        "id" SERIAL NOT NULL,
        "product_id" integer NOT NULL,
        "subsidiary_one_stock" integer NOT NULL DEFAULT 0,
        "subsidiary_two_stock" integer NOT NULL DEFAULT 0,
        "has_stock" boolean NOT NULL DEFAULT false,
        "error" text,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PRODUCT_STOCK" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_PRODUCT_STOCK_PRODUCT_ID" UNIQUE ("product_id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "product_stock"
      ADD CONSTRAINT "fk_product_stock"
      FOREIGN KEY ("product_id")
      REFERENCES "product"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_stock" DROP CONSTRAINT "fk_product_stock"`);
    await queryRunner.query(`DROP TABLE "product_stock"`);
  }
}
