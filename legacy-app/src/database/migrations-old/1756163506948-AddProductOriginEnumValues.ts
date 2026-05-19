import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductOriginEnumValues1756163506948 implements MigrationInterface {
    public name = 'AddProductOriginEnumValues1756163506948'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_image" DROP CONSTRAINT "FK_product_image_product"`);
        await queryRunner.query(`ALTER TYPE "public"."origin_enum" RENAME TO "origin_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."origin_enum" AS ENUM('DROGAL', 'DROGASIL', 'PAGUE_MENOS', 'IKESAKI')`);
        await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "origin" TYPE "public"."origin_enum" USING "origin"::"text"::"public"."origin_enum"`);
        await queryRunner.query(`DROP TYPE "public"."origin_enum_old"`);
        await queryRunner.query(`ALTER TABLE "product_image" ADD CONSTRAINT "fk_product_image" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product_image" DROP CONSTRAINT "fk_product_image"`);
        await queryRunner.query(`CREATE TYPE "public"."origin_enum_old" AS ENUM('DROGAL', 'DROGASIL')`);
        await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "origin" TYPE "public"."origin_enum_old" USING "origin"::"text"::"public"."origin_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."origin_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."origin_enum_old" RENAME TO "origin_enum"`);
        await queryRunner.query(`ALTER TABLE "product_image" ADD CONSTRAINT "FK_product_image_product" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
