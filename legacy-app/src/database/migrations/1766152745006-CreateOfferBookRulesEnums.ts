import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookRulesEnums1766152745006 implements MigrationInterface {
  public name = 'CreateOfferBookRulesEnums1766152745006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "pricing_action_type_enum" AS ENUM ('DISCOUNT', 'INCREASE')
    `);

    await queryRunner.query(`
      CREATE TYPE "calculation_base_type_enum" AS ENUM ('LOWEST_COMPETITOR_PRICE', 'SALE_PRICE', 'OFFER_PRICE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TYPE "calculation_base_type_enum"`);
    await queryRunner.query(`DROP TYPE "pricing_action_type_enum"`);
  }
}
