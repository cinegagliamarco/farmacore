import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameCategoriesToClassifications1766152745011 implements MigrationInterface {
  public name = 'RenameCategoriesToClassifications1766152745011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename column in offer_book_pricing_rules
    await queryRunner.query(`ALTER TABLE "offer_book_pricing_rules" RENAME COLUMN "categories" TO "classifications"`);
    await queryRunner.query(`ALTER TABLE "offer_book_pricing_rules" ALTER COLUMN "classifications" DROP NOT NULL`);

    // Rename column in offer_book_price_locks
    await queryRunner.query(`ALTER TABLE "offer_book_price_locks" RENAME COLUMN "categories" TO "classifications"`);
    await queryRunner.query(`ALTER TABLE "offer_book_price_locks" ALTER COLUMN "classifications" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert offer_book_price_locks
    await queryRunner.query(`ALTER TABLE "offer_book_price_locks" ALTER COLUMN "classifications" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "offer_book_price_locks" RENAME COLUMN "classifications" TO "categories"`);

    // Revert offer_book_pricing_rules
    await queryRunner.query(`ALTER TABLE "offer_book_pricing_rules" ALTER COLUMN "classifications" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "offer_book_pricing_rules" RENAME COLUMN "classifications" TO "categories"`);
  }
}
