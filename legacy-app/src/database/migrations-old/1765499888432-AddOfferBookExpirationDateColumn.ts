import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferBookExpirationDateColumn1765499888432 implements MigrationInterface {
  name = 'AddOfferBookExpirationDateColumn1765499888432';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book" ADD "expiration_date" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book" DROP COLUMN "expiration_date"`);
  }
}
