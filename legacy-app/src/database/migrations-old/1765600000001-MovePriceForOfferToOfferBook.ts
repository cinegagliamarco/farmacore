import { MigrationInterface, QueryRunner } from 'typeorm';

export class MovePriceForOfferToOfferBook1765600000001 implements MigrationInterface {
  public name = 'MovePriceForOfferToOfferBook1765600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add price_for_offer and deals columns to offer_book
    await queryRunner.query(`ALTER TABLE "offer_book" ADD "price_for_offer" numeric(15,4)`);
    await queryRunner.query(`ALTER TABLE "offer_book" ADD "deals" jsonb`);

    // Add index for price_for_offer on offer_book
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICE_FOR_OFFER" ON "offer_book" ("price_for_offer")`);

    // Drop index from base_product
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_BASE_PRODUCT_PRICE_FOR_OFFER"`);

    // Drop columns from base_product
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN IF EXISTS "price_for_offer"`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN IF EXISTS "deals"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add columns back to base_product
    await queryRunner.query(`ALTER TABLE "base_product" ADD "price_for_offer" numeric(15,4)`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "deals" jsonb`);

    // Recreate index on base_product
    await queryRunner.query(`CREATE INDEX "IDX_BASE_PRODUCT_PRICE_FOR_OFFER" ON "base_product" ("price_for_offer")`);

    // Drop index from offer_book
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_OFFER_BOOK_PRICE_FOR_OFFER"`);

    // Drop columns from offer_book
    await queryRunner.query(`ALTER TABLE "offer_book" DROP COLUMN "deals"`);
    await queryRunner.query(`ALTER TABLE "offer_book" DROP COLUMN "price_for_offer"`);
  }
}

