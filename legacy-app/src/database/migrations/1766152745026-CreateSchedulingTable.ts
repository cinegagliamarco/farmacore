import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSchedulingTable1766152745026 implements MigrationInterface {
  public name = 'CreateSchedulingTable1766152745026';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "scheduling_action_enum" AS ENUM ('UPDATE_PRICE', 'UPDATE_PRICE_OFFER')
    `);

    await queryRunner.query(`
      CREATE TABLE "scheduling" (
        "id" SERIAL PRIMARY KEY,
        "execution_date" TIMESTAMPTZ NOT NULL,
        "base_product_id" INTEGER NOT NULL,
        "action" "scheduling_action_enum" NOT NULL,
        "value" VARCHAR(255) NOT NULL,
        "executed" BOOLEAN NOT NULL DEFAULT false,
        "error" TEXT,
        "inserted_date" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "fk_scheduling_base_product" FOREIGN KEY ("base_product_id") REFERENCES "base_product"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_SCHEDULING_EXECUTION_DATE" ON "scheduling" ("execution_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_SCHEDULING_EXECUTED" ON "scheduling" ("executed")`);
    await queryRunner.query(`CREATE INDEX "IDX_SCHEDULING_BASE_PRODUCT_ID" ON "scheduling" ("base_product_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_SCHEDULING_BASE_PRODUCT_ID"`);
    await queryRunner.query(`DROP INDEX "IDX_SCHEDULING_EXECUTED"`);
    await queryRunner.query(`DROP INDEX "IDX_SCHEDULING_EXECUTION_DATE"`);
    await queryRunner.query(`DROP TABLE "scheduling"`);
    await queryRunner.query(`DROP TYPE "scheduling_action_enum"`);
  }
}

