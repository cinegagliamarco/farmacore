import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceBaseSourcesAndUpdateCalculationBaseType1766152745033 implements MigrationInterface {
  public name = 'AddPriceBaseSourcesAndUpdateCalculationBaseType1766152745033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "price_base_source_enum" AS ENUM('OWN_PRICE', 'DROGAL', 'DROGASIL', 'PAGUE_MENOS', 'IKESAKI', 'MICHELASSI')`
    );

    await queryRunner.query(`ALTER TABLE "offer_book_rules" ADD "price_base_sources" text`);

    await queryRunner.query(`ALTER TYPE "calculation_base_type_enum" ADD VALUE 'COMPETITIVE_PRICE'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "offer_book_rules" DROP COLUMN "price_base_sources"`);

    await queryRunner.query(`DROP TYPE "price_base_source_enum"`);
  }
}
