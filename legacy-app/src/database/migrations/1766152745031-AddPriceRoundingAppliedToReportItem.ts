import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceRoundingAppliedToReportItem1766152745031 implements MigrationInterface {
  public name = 'AddPriceRoundingAppliedToReportItem1766152745031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" ADD "price_rounding_applied" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report_item" DROP COLUMN "price_rounding_applied"`);
  }
}
