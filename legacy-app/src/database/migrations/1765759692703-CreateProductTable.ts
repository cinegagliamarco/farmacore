import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductTable1765759692703 implements MigrationInterface {
  public name = 'CreateProductTable1765759692703';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product" (
        "id" SERIAL NOT NULL,
        "ean" bigint NOT NULL,
        "name" character varying(255),
        "origin" "public"."origin_enum" NOT NULL,
        "price" numeric(10,2) NOT NULL DEFAULT '0',
        "observation" text,
        "brand" character varying(255),
        "image" character varying(255),
        "sku" bigint,
        "exists" boolean NOT NULL DEFAULT false,
        "description" text,
        "category" text,
        "weight" numeric(10,3),
        "error" text,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PRODUCT" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "product"`);
  }
}
