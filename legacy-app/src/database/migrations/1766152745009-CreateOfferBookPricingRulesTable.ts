import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookPricingRulesTable1766152745009 implements MigrationInterface {
  public name = 'CreateOfferBookPricingRulesTable1766152745009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book_pricing_rules" (
        "id" SERIAL NOT NULL,
        "offer_book_rules_id" bigint NOT NULL,
        "categories" text[] NOT NULL,
        "price_range_min" numeric(10,2),
        "price_range_max" numeric(10,2),
        "margin_range_min" numeric(10,2),
        "margin_range_max" numeric(10,2),
        "action_type" "pricing_action_type_enum" NOT NULL,
        "percentage_value" numeric(10,2) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_PRICING_RULES" PRIMARY KEY ("id"),
        CONSTRAINT "FK_OFFER_BOOK_PRICING_RULES_RULES" FOREIGN KEY ("offer_book_rules_id") REFERENCES "offer_book_rules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICING_RULES_RULES_ID" ON "offer_book_pricing_rules" ("offer_book_rules_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICING_RULES_ACTIVE" ON "offer_book_pricing_rules" ("active")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICING_RULES_ACTION_TYPE" ON "offer_book_pricing_rules" ("action_type")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICING_RULES_ACTION_TYPE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICING_RULES_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICING_RULES_RULES_ID"`);
    await queryRunner.query(`DROP TABLE "offer_book_pricing_rules"`);
  }
}
