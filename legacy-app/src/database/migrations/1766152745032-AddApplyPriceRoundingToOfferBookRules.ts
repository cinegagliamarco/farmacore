import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplyPriceRoundingToOfferBookRules1766152745032 implements MigrationInterface {
  public name = 'AddApplyPriceRoundingToOfferBookRules1766152745032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD "apply_price_rounding" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "apply_price_rounding"`);
  }
}
