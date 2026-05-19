import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookTable1765759692705 implements MigrationInterface {
  public name = 'CreateOfferBookTable1765759692705';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book" (
        "id" SERIAL NOT NULL,
        "base_product_id" integer NOT NULL,
        "name" character varying(255) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "external_id" bigint NOT NULL,
        "expiration_date" TIMESTAMP WITH TIME ZONE,
        "price_for_offer" numeric(15,4),
        "deals" jsonb,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint - matches entity definition (no onDelete specified = NO ACTION)
    await queryRunner.query(`
      ALTER TABLE "offer_book"
      ADD CONSTRAINT "fk_offer_book_base_product"
      FOREIGN KEY ("base_product_id")
      REFERENCES "base_product"("id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);

    // Add indexes
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_NAME" ON "offer_book" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_ACTIVE" ON "offer_book" ("active")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_EXTERNAL_ID" ON "offer_book" ("external_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_BASE_PRODUCT_ID" ON "offer_book" ("base_product_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICE_FOR_OFFER" ON "offer_book" ("price_for_offer")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICE_FOR_OFFER"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_BASE_PRODUCT_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_EXTERNAL_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_NAME"`);
    await queryRunner.query(`ALTER TABLE "offer_book" DROP CONSTRAINT "fk_offer_book_base_product"`);
    await queryRunner.query(`DROP TABLE "offer_book"`);
  }
}
