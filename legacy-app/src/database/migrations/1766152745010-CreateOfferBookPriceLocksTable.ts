import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookPriceLocksTable1766152745010 implements MigrationInterface {
  public name = 'CreateOfferBookPriceLocksTable1766152745010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book_price_locks" (
        "id" SERIAL NOT NULL,
        "offer_book_rules_id" bigint NOT NULL,
        "categories" text[] NOT NULL,
        "min_margin" numeric(10,2) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_PRICE_LOCKS" PRIMARY KEY ("id"),
        CONSTRAINT "FK_OFFER_BOOK_PRICE_LOCKS_RULES" FOREIGN KEY ("offer_book_rules_id") REFERENCES "offer_book_rules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICE_LOCKS_RULES_ID" ON "offer_book_price_locks" ("offer_book_rules_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_PRICE_LOCKS_ACTIVE" ON "offer_book_price_locks" ("active")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICE_LOCKS_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_PRICE_LOCKS_RULES_ID"`);
    await queryRunner.query(`DROP TABLE "offer_book_price_locks"`);
  }
}
