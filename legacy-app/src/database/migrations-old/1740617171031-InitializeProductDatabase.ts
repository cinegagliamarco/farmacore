import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitializeProductDatabase1740617171031 implements MigrationInterface {
  name = 'InitializeProductDatabase1740617171031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "public"."origin_enum" AS ENUM('DROGAL', 'DROGASIL')`);
    await queryRunner.query(
      `CREATE TABLE "product" ("id" SERIAL NOT NULL, "ean" bigint NOT NULL, "name" character varying(255), "origin" "public"."origin_enum" NOT NULL, "price" numeric(10,2) NOT NULL DEFAULT '0', "observation" text, "brand" character varying(255), "image" character varying(255), "sku" bigint, "subsidiary_one_stock" integer NOT NULL DEFAULT '0', "subsidiary_two_stock" integer NOT NULL DEFAULT '0', "has_stock" boolean NOT NULL DEFAULT false, "exists" boolean NOT NULL DEFAULT false, "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bebc9158e480b949565b4dc7a82" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "import_process" ("id" SERIAL NOT NULL, "finished" boolean NOT NULL DEFAULT false, "process_name" character varying NOT NULL, "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6655acd6056f1876dbf2588a336" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE TABLE "base_product" ("id" SERIAL NOT NULL, "ean" bigint NOT NULL, "name" character varying(255), "price" numeric(10,2), "book" character varying(255), "curve" character varying(1), "generic" boolean NOT NULL DEFAULT false, "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0ef9c06b3a37b436970e697dcfc" PRIMARY KEY ("id"))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "base_product"`);
    await queryRunner.query(`DROP TABLE "import_process"`);
    await queryRunner.query(`DROP TABLE "product"`);
    await queryRunner.query(`DROP TYPE "public"."origin_enum"`);
  }
}
