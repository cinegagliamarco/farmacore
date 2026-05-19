import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppliedPercentageValueToReportItem1766152745021 implements MigrationInterface {
  public name = 'AddAppliedPercentageValueToReportItem1766152745021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add applied_percentage_value column to offer_book_rules_execution_report_item table
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report_item"
      ADD COLUMN "applied_percentage_value" numeric(10,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove applied_percentage_value column from offer_book_rules_execution_report_item table
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report_item"
      DROP COLUMN "applied_percentage_value"
    `);
  }
}
