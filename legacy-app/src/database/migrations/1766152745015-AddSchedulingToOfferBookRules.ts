import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchedulingToOfferBookRules1766152745015 implements MigrationInterface {
  public name = 'AddSchedulingToOfferBookRules1766152745015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add schedule_enabled column
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules"
      ADD COLUMN "schedule_enabled" boolean NOT NULL DEFAULT false
    `);

    // Add scheduled_days column (stored as comma-separated text for simple-array)
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules"
      ADD COLUMN "scheduled_days" text NULL
    `);

    // Add last_scheduled_execution column
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules"
      ADD COLUMN "last_scheduled_execution" TIMESTAMP NULL
    `);

    // Add index on schedule_enabled for performance
    await queryRunner.query(`
      CREATE INDEX "IDX_OFFER_BOOK_RULES_SCHEDULE_ENABLED"
      ON "offer_book_rules" ("schedule_enabled")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_SCHEDULE_ENABLED"`);

    // Drop columns
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "last_scheduled_execution"`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "scheduled_days"`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "schedule_enabled"`);
  }
}
