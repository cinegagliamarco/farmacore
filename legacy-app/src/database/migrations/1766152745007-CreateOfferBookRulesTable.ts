import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookRulesTable1766152745007 implements MigrationInterface {
  public name = 'CreateOfferBookRulesTable1766152745007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book_rules" (
        "id" SERIAL NOT NULL,
        "offer_book_info_id" bigint NOT NULL,
        "name" character varying(255) NOT NULL,
        "description" text,
        "calculation_base_type" "calculation_base_type_enum" NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_RULES" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_OFFER_BOOK_RULES_OFFER_BOOK_INFO_ID" UNIQUE ("offer_book_info_id"),
        CONSTRAINT "FK_OFFER_BOOK_RULES_OFFER_BOOK_INFO" FOREIGN KEY ("offer_book_info_id") REFERENCES "offer_book_info"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_OFFER_BOOK_RULES_OFFER_BOOK_INFO_ID" ON "offer_book_rules" ("offer_book_info_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_NAME" ON "offer_book_rules" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_ACTIVE" ON "offer_book_rules" ("active")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_CALCULATION_BASE_TYPE" ON "offer_book_rules" ("calculation_base_type")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_CALCULATION_BASE_TYPE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_NAME"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_OFFER_BOOK_INFO_ID"`);
    await queryRunner.query(`DROP TABLE "offer_book_rules"`);
  }
}
