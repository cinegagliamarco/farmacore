import { MigrationInterface, QueryRunner } from 'typeorm';

export class MoveDealsToBaseProduct1765759692710 implements MigrationInterface {
  public name = 'MoveDealsToBaseProduct1765759692710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add deals column to base_product table
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "deals" jsonb`);

    // Drop deals column from offer_book table
    await queryRunner.query(`ALTER TABLE "offer_book" DROP COLUMN "deals"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add deals column back to offer_book table
    await queryRunner.query(`ALTER TABLE "offer_book" ADD COLUMN "deals" jsonb`);

    // Drop deals column from base_product table
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "deals"`);
  }
}
