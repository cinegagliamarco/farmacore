import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateCompetitorPriceToCompetitivePrice1766152745034 implements MigrationInterface {
  public name = 'MigrateCompetitorPriceToCompetitivePrice1766152745034';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "offer_book_rules"
      SET 
        "calculation_base_type" = 'COMPETITIVE_PRICE',
        "price_base_sources" = 'OWN_PRICE,DROGAL,DROGASIL,PAGUE_MENOS,IKESAKI,MICHELASSI'
      WHERE "calculation_base_type" = 'LOWEST_COMPETITOR_PRICE'
    `);

    await queryRunner.query(`
      UPDATE "offer_book_rules"
      SET 
        "calculation_base_type" = 'COMPETITIVE_PRICE',
        "price_base_sources" = 'DROGAL,DROGASIL,PAGUE_MENOS,IKESAKI,MICHELASSI'
      WHERE "calculation_base_type" = 'STRICT_COMPETITOR_PRICE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "offer_book_rules"
      SET 
        "calculation_base_type" = 'LOWEST_COMPETITOR_PRICE',
        "price_base_sources" = NULL
      WHERE "calculation_base_type" = 'COMPETITIVE_PRICE' 
        AND "price_base_sources" = 'OWN_PRICE,DROGAL,DROGASIL,PAGUE_MENOS,IKESAKI,MICHELASSI'
    `);

    await queryRunner.query(`
      UPDATE "offer_book_rules"
      SET 
        "calculation_base_type" = 'STRICT_COMPETITOR_PRICE',
        "price_base_sources" = NULL
      WHERE "calculation_base_type" = 'COMPETITIVE_PRICE' 
        AND "price_base_sources" = 'DROGAL,DROGASIL,PAGUE_MENOS,IKESAKI,MICHELASSI'
    `);
  }
}
