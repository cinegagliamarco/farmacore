import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookTable1765500000001 implements MigrationInterface {
  public name = 'CreateOfferBookTable1765500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book" (
        "id" SERIAL NOT NULL,
        "base_product_id" bigint NOT NULL,
        "name" character varying(255) NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "external_id" bigint NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "offer_book"
      ADD CONSTRAINT "fk_offer_book_base_product"
      FOREIGN KEY ("base_product_id")
      REFERENCES "base_product"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Add indexes
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_NAME" ON "offer_book" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_ACTIVE" ON "offer_book" ("active")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_EXTERNAL_ID" ON "offer_book" ("external_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_BASE_PRODUCT_ID" ON "offer_book" ("base_product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_BASE_PRODUCT_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_EXTERNAL_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_NAME"`);
    await queryRunner.query(`ALTER TABLE "offer_book" DROP CONSTRAINT "fk_offer_book_base_product"`);
    await queryRunner.query(`DROP TABLE "offer_book"`);
  }
}
