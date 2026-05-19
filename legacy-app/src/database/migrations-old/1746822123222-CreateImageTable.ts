import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateImageTable1746822123222 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_image" (
        "id" SERIAL PRIMARY KEY,
        "product_id" integer NOT NULL,
        "link" character varying(255) NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_product_image_product" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "product_image"');
  }
} 