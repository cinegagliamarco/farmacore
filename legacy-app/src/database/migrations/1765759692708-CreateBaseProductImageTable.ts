import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBaseProductImageTable1765759692708 implements MigrationInterface {
  public name = 'CreateBaseProductImageTable1765759692708';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "base_product_image" (
        "id" SERIAL NOT NULL,
        "base_product_id" integer NOT NULL,
        "url" character varying(255) NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_BASE_PRODUCT_IMAGE" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "base_product_image"
      ADD CONSTRAINT "fk_base_product_image"
      FOREIGN KEY ("base_product_id")
      REFERENCES "base_product"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_image" DROP CONSTRAINT "fk_base_product_image"`);
    await queryRunner.query(`DROP TABLE "base_product_image"`);
  }
}
