import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusToOfferBookRules1766152745028 implements MigrationInterface {
  public name = 'AddStatusToOfferBookRules1766152745028';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "offer_book_rules_status_enum" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'ERRORED')
    `);

    await queryRunner.query(`
      ALTER TABLE "offer_book_rules"
      ADD COLUMN "status" "offer_book_rules_status_enum" NOT NULL DEFAULT 'IDLE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules" DROP COLUMN "status"
    `);

    await queryRunner.query(`
      DROP TYPE "offer_book_rules_status_enum"
    `);
  }
}
