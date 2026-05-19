import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfferBookInfoTable1766152745005 implements MigrationInterface {
  public name = 'CreateOfferBookInfoTable1766152745005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offer_book_info" (
        "id" SERIAL NOT NULL,
        "name" character varying(255) NOT NULL,
        "external_id" bigint NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "start_date" TIMESTAMP WITH TIME ZONE,
        "expiration_date" TIMESTAMP WITH TIME ZONE,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_OFFER_BOOK_INFO" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_OFFER_BOOK_INFO_EXTERNAL_ID" UNIQUE ("external_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_INFO_NAME" ON "offer_book_info" ("name")`);
    await queryRunner.query(`CREATE INDEX "IDX_OFFER_BOOK_INFO_ACTIVE" ON "offer_book_info" ("active")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_OFFER_BOOK_INFO_EXTERNAL_ID" ON "offer_book_info" ("external_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_INFO_EXTERNAL_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_INFO_ACTIVE"`);
    await queryRunner.query(`DROP INDEX "IDX_OFFER_BOOK_INFO_NAME"`);
    await queryRunner.query(`DROP TABLE "offer_book_info"`);
  }
}
