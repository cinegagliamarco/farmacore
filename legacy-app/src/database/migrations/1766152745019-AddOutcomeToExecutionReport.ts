import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutcomeToExecutionReport1766152745019 implements MigrationInterface {
  public name = 'AddOutcomeToExecutionReport1766152745019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create execution_outcome_enum if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "execution_outcome_enum" AS ENUM('SUCCESS', 'FAILURE');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add outcome column
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report"
      ADD COLUMN "outcome" "execution_outcome_enum" NOT NULL DEFAULT 'SUCCESS'
    `);

    // Add error_message column
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report"
      ADD COLUMN "error_message" text
    `);

    // Add index for outcome
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OUTCOME" ON "offer_book_rules_execution_report" ("outcome")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OUTCOME"`);

    // Drop columns
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report" DROP COLUMN "error_message"`);
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report" DROP COLUMN "outcome"`);

    // Drop execution_outcome_enum (only if not used elsewhere)
    await queryRunner.query(`DROP TYPE "execution_outcome_enum"`);
  }
}
