import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookRulesProductsTable1766152745008 implements MigrationInterface {
  public name = 'CreateOfferBookRulesProductsTable1766152745008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book_rules_products" (
        "id" SERIAL NOT NULL,
        "offer_book_rules_id" bigint NOT NULL,
        "base_product_id" bigint NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_RULES_PRODUCTS" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_OFFER_BOOK_RULES_PRODUCTS" UNIQUE ("offer_book_rules_id", "base_product_id"),
        CONSTRAINT "FK_OFFER_BOOK_RULES_PRODUCTS_RULES" FOREIGN KEY ("offer_book_rules_id") REFERENCES "offer_book_rules"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_OFFER_BOOK_RULES_PRODUCTS_BASE_PRODUCT" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_PRODUCTS_RULES_ID" ON "offer_book_rules_products" ("offer_book_rules_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_PRODUCTS_BASE_PRODUCT_ID" ON "offer_book_rules_products" ("base_product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_PRODUCTS_BASE_PRODUCT_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_PRODUCTS_RULES_ID"`);
    await queryRunner.query(`DROP TABLE "offer_book_rules_products"`);
  }
}
