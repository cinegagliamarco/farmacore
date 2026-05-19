import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookRulesExecutionReportTables1766152745018 implements MigrationInterface {
  public name = 'CreateOfferBookRulesExecutionReportTables1766152745018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create execution_type_enum if it doesn't exist
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "execution_type_enum" AS ENUM('MANUAL', 'SCHEDULED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create offer_book_rules_execution_report table
    await queryRunner.query(`
      CREATE TABLE "offer_book_rules_execution_report" (
        "id" SERIAL NOT NULL,
        "offer_book_rules_id" integer NOT NULL,
        "offer_book_info_id" bigint NOT NULL,
        "executed_at" TIMESTAMP NOT NULL,
        "execution_type" "execution_type_enum" NOT NULL,
        "calculation_base_type" "calculation_base_type_enum" NOT NULL,
        "total_products" integer NOT NULL DEFAULT 0,
        "products_updated" integer NOT NULL DEFAULT 0,
        "products_skipped" integer NOT NULL DEFAULT 0,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_RULES_EXECUTION_REPORT" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint for offer_book_rules_id
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report"
      ADD CONSTRAINT "fk_offer_book_rules_execution_report_rules"
      FOREIGN KEY ("offer_book_rules_id")
      REFERENCES "offer_book_rules"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Add indexes for offer_book_rules_execution_report
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_RULES_ID" ON "offer_book_rules_execution_report" ("offer_book_rules_id")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTED_AT" ON "offer_book_rules_execution_report" ("executed_at")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTION_TYPE" ON "offer_book_rules_execution_report" ("execution_type")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OFFER_BOOK_INFO_ID" ON "offer_book_rules_execution_report" ("offer_book_info_id")`
    );

    // Create offer_book_rules_execution_report_item table
    await queryRunner.query(`
      CREATE TABLE "offer_book_rules_execution_report_item" (
        "id" SERIAL NOT NULL,
        "execution_report_id" integer NOT NULL,
        "ean" bigint NOT NULL,
        "name" character varying(500) NOT NULL,
        "classification" character varying(500) NOT NULL,
        "base_sale_price" numeric(15,4) NOT NULL DEFAULT 0,
        "current_price" numeric(15,4) NOT NULL DEFAULT 0,
        "current_margin" numeric(10,2) NOT NULL DEFAULT 0,
        "cost" numeric(15,4) NOT NULL DEFAULT 0,
        "action_type" "pricing_action_type_enum",
        "percentage_value" numeric(10,2) NOT NULL DEFAULT 0,
        "final_price" numeric(15,4) NOT NULL DEFAULT 0,
        "new_margin" numeric(10,2) NOT NULL DEFAULT 0,
        "price_lock_applied" boolean NOT NULL DEFAULT false,
        "discount_skipped" boolean NOT NULL DEFAULT false,
        "skipped_no_competitor_price" boolean NOT NULL DEFAULT false,
        "skipped_price_exceeds_limit" boolean NOT NULL DEFAULT false,
        "was_updated" boolean NOT NULL DEFAULT false,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint for execution_report_id
    await queryRunner.query(`
      ALTER TABLE "offer_book_rules_execution_report_item"
      ADD CONSTRAINT "fk_offer_book_rules_execution_report_item_report"
      FOREIGN KEY ("execution_report_id")
      REFERENCES "offer_book_rules_execution_report"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Add indexes for offer_book_rules_execution_report_item
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_REPORT_ID" ON "offer_book_rules_execution_report_item" ("execution_report_id")`
    );
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_EAN" ON "offer_book_rules_execution_report_item" ("ean")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_WAS_UPDATED" ON "offer_book_rules_execution_report_item" ("was_updated")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes for offer_book_rules_execution_report_item
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_WAS_UPDATED"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_EAN"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_REPORT_ID"`);

    // Drop foreign key constraint
    await queryRunner.query(
      `ALTER TABLE "offer_book_rules_execution_report_item" DROP CONSTRAINT "fk_offer_book_rules_execution_report_item_report"`
    );

    // Drop offer_book_rules_execution_report_item table
    await queryRunner.query(`DROP TABLE "offer_book_rules_execution_report_item"`);

    // Drop indexes for offer_book_rules_execution_report
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OFFER_BOOK_INFO_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTION_TYPE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTED_AT"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_RULES_ID"`);

    // Drop foreign key constraint
    await queryRunner.query(`ALTER TABLE "offer_book_rules_execution_report" DROP CONSTRAINT "fk_offer_book_rules_execution_report_rules"`);

    // Drop offer_book_rules_execution_report table
    await queryRunner.query(`DROP TABLE "offer_book_rules_execution_report"`);

    // Drop execution_type_enum (only if not used elsewhere)
    await queryRunner.query(`DROP TYPE "execution_type_enum"`);
  }
}
