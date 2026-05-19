import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveColumnsFromOfferBookRules1766152745014 implements MigrationInterface {
  public name = 'RemoveColumnsFromOfferBookRules1766152745014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_OFFER_BOOK_RULES_NAME"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_OFFER_BOOK_RULES_ACTIVE"`);

    // Drop columns
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN IF EXISTS "name"`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN IF EXISTS "description"`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN IF EXISTS "active"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add columns back
    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD COLUMN "name" character varying(255) NOT NULL DEFAULT ''`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD COLUMN "description" text`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD COLUMN "active" boolean NOT NULL DEFAULT true`);

    // Recreate indexes
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_NAME" ON "offer_book_rules" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_ACTIVE" ON "offer_book_rules" ("active")`);
  }
}
