import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClassificationTable1766152745022 implements MigrationInterface {
  public name = 'CreateClassificationTable1766152745022';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create classification table
    await queryRunner.query(`
      CREATE TABLE "classification" (
        "id" SERIAL NOT NULL,
        "name" character varying(500) NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_CLASSIFICATION" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_CLASSIFICATION_NAME" UNIQUE ("name")
      )
    `);

    // Add index for name lookups
    await queryRunner.query(`CREATE INDEX "IDX_CLASSIFICATION_NAME" ON "classification" ("name")`);

    // Migrate existing classification data from base_product to classification table
    await queryRunner.query(`
      INSERT INTO "classification" ("name")
      SELECT DISTINCT classification
      FROM "base_product"
      WHERE classification IS NOT NULL AND classification != ''
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_CLASSIFICATION_NAME"`);
    await queryRunner.query(`DROP TABLE "classification"`);
  }
}
