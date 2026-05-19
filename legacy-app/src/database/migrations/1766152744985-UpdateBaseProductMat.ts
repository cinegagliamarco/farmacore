import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateBaseProductMat1766152744985 implements MigrationInterface {
  public name = 'UpdateBaseProductMat1766152744985';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product_stock" ALTER COLUMN "subsidiary_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "base_product_stock" ALTER COLUMN "subsidiary_name" SET NOT NULL`);
    await queryRunner.query(`ALTER TYPE "public"."base_product_origin_enum" RENAME TO "base_product_origin_enum_old"`);
    await queryRunner.query(`CREATE TYPE "public"."base_product_origin_enum" AS ENUM('ERP', 'CSV')`);
    await queryRunner.query(
      `ALTER TABLE "base_product" ALTER COLUMN "origin" TYPE "public"."base_product_origin_enum" USING "origin"::"text"::"public"."base_product_origin_enum"`
    );
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" SET DEFAULT 'ERP'`);
    await queryRunner.query(`DROP TYPE "public"."base_product_origin_enum_old"`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" SET DEFAULT 'ERP'`);
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "mat"`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "mat" numeric(10,2) NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "mat"`);
    await queryRunner.query(`ALTER TABLE "base_product" ADD "mat" integer NOT NULL DEFAULT '0'`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" DROP NOT NULL`);
    await queryRunner.query(`CREATE TYPE "public"."base_product_origin_enum_old" AS ENUM('ERP', 'CSV')`);
    await queryRunner.query(`ALTER TABLE "base_product" ALTER COLUMN "origin" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "base_product" ALTER COLUMN "origin" TYPE "public"."base_product_origin_enum_old" USING "origin"::"text"::"public"."base_product_origin_enum_old"`
    );
    await queryRunner.query(`DROP TYPE "public"."base_product_origin_enum"`);
    await queryRunner.query(`ALTER TYPE "public"."base_product_origin_enum_old" RENAME TO "base_product_origin_enum"`);
    await queryRunner.query(`ALTER TABLE "base_product_stock" ALTER COLUMN "subsidiary_name" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "base_product_stock" ALTER COLUMN "subsidiary_id" DROP NOT NULL`);
  }
}
