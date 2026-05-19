import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGroupedClassificationsToOfferBookRules1766152745027 implements MigrationInterface {
  public name = 'AddGroupedClassificationsToOfferBookRules1766152745027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD COLUMN "grouped_classifications" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "grouped_classifications"`);
  }
}
