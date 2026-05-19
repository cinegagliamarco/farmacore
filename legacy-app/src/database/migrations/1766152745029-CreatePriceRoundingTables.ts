import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceRoundingTables1766152745029 implements MigrationInterface {
  public name = 'CreatePriceRoundingTables1766152745029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "price_rounding_rule" (
        "id" SERIAL NOT NULL,
        "price_range_min" numeric(10,2) NOT NULL DEFAULT 0,
        "price_range_max" numeric(10,2) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PRICE_ROUNDING_RULE" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_PRICE_ROUNDING_RULE_ACTIVE" ON "price_rounding_rule" ("active")`);
    await queryRunner.query(`CREATE INDEX "IDX_PRICE_ROUNDING_RULE_PRICE_RANGE" ON "price_rounding_rule" ("price_range_min", "price_range_max")`);

    await queryRunner.query(`
      CREATE TABLE "price_rounding_decimal_range" (
        "id" SERIAL NOT NULL,
        "price_rounding_rule_id" integer NOT NULL,
        "decimal_range_from" numeric(10,2) NOT NULL DEFAULT 0,
        "decimal_range_to" numeric(10,2) NOT NULL DEFAULT 0,
        "round_to" numeric(10,2) NOT NULL DEFAULT 0,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PRICE_ROUNDING_DECIMAL_RANGE" PRIMARY KEY ("id"),
        CONSTRAINT "fk_price_rounding_decimal_range_rule" FOREIGN KEY ("price_rounding_rule_id") REFERENCES "price_rounding_rule"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_PRICE_ROUNDING_DECIMAL_RANGE_RULE_ID" ON "price_rounding_decimal_range" ("price_rounding_rule_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_PRICE_ROUNDING_DECIMAL_RANGE_RULE_ID"`);
    await queryRunner.query(`DROP TABLE "price_rounding_decimal_range"`);
    await queryRunner.query(`DROP INDEX "IDX_PRICE_ROUNDING_RULE_PRICE_RANGE"`);
    await queryRunner.query(`DROP INDEX "IDX_PRICE_ROUNDING_RULE_ACTIVE"`);
    await queryRunner.query(`DROP TABLE "price_rounding_rule"`);
  }
}
