import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStatusSettingsTable1766152745030 implements MigrationInterface {
  public name = 'CreateStatusSettingsTable1766152745030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "status_settings" (
        "id" SERIAL NOT NULL,
        "suspect_below" numeric(10,2) NOT NULL DEFAULT -15,
        "attention_below" numeric(10,2) NOT NULL DEFAULT 0,
        "attention_above" numeric(10,2) NOT NULL DEFAULT 20,
        "suspect_above" numeric(10,2) NOT NULL DEFAULT 50,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_STATUS_SETTINGS" PRIMARY KEY ("id")
      )
    `);

    // Insert initial record with default values based on the original calculateStatus logic
    await queryRunner.query(`
      INSERT INTO "status_settings" ("suspect_below", "attention_below", "attention_above", "suspect_above")
      VALUES (-15, 0, 20, 50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "status_settings"`);
  }
}

