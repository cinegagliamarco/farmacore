import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductImageTable1765759692707 implements MigrationInterface {
  public name = 'CreateProductImageTable1765759692707';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_image" (
        "id" SERIAL NOT NULL,
        "product_id" integer NOT NULL,
        "url" character varying(255) NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PRODUCT_IMAGE" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "product_image"
      ADD CONSTRAINT "fk_product_image"
      FOREIGN KEY ("product_id")
      REFERENCES "product"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_image" DROP CONSTRAINT "fk_product_image"`);
    await queryRunner.query(`DROP TABLE "product_image"`);
  }
}
