import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBaseProductTable1765759692702 implements MigrationInterface {
  public name = 'CreateBaseProductTable1765759692702';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "base_product" (
        "id" SERIAL NOT NULL,
        "external_id" bigint,
        "ean" bigint NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "name" character varying(255),
        "price" numeric(10,2),
        "book" character varying(255),
        "curve" character varying(1),
        "generic" boolean NOT NULL DEFAULT false,
        "average_unit_cost" numeric(10,2),
        "unit_sale_price" numeric(10,2),
        "description" text,
        "supplier" character varying(255),
        "classification" character varying(500),
        "cost" numeric(15,4),
        "margin" numeric(10,2),
        "average_variation" numeric(10,2),
        "status" character varying(20),
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BASE_PRODUCT" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_BASE_PRODUCT_EAN" UNIQUE ("ean"),
        CONSTRAINT "UQ_BASE_PRODUCT_EXTERNAL_ID" UNIQUE ("external_id")
      )
    `);

    // Add indexes
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_NAME" ON "base_product" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_EAN" ON "base_product" ("ean")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_SUPPLIER" ON "base_product" ("supplier")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_CLASSIFICATION" ON "base_product" ("classification")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_BOOK" ON "base_product" ("book")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_COST" ON "base_product" ("cost")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_PRICE" ON "base_product" ("price")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_MARGIN" ON "base_product" ("margin")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_AVERAGE_VARIATION" ON "base_product" ("average_variation")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_STATUS" ON "base_product" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_EXTERNAL_ID" ON "base_product" ("external_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_EXTERNAL_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_STATUS"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_AVERAGE_VARIATION"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_MARGIN"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_PRICE"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_COST"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_BOOK"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_CLASSIFICATION"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_SUPPLIER"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_EAN"`);
    await queryRunner.query(`DROP INDEX "IDX_BASE_PRODUCT_NAME"`);
    await queryRunner.query(`DROP TABLE "base_product"`);
  }
}
