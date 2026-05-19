import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMichelassiProductOriginEnumValue1756839378713 implements MigrationInterface {
    name = 'AddMichelassiProductOriginEnumValue1756839378713'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."origin_enum" RENAME TO "origin_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."origin_enum" AS ENUM('DROGAL', 'DROGASIL', 'PAGUE_MENOS', 'IKESAKI', 'MICHELASSI')`);
        await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "origin" TYPE "public"."origin_enum" USING "origin"::"text"::"public"."origin_enum"`);
        await queryRunner.query(`DROP TYPE "public"."origin_enum_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."origin_enum_old" AS ENUM('DROGAL', 'DROGASIL', 'PAGUE_MENOS', 'IKESAKI')`);
        await queryRunner.query(`ALTER TABLE "product" ALTER COLUMN "origin" TYPE "public"."origin_enum_old" USING "origin"::"text"::"public"."origin_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."origin_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."origin_enum_old" RENAME TO "origin_enum"`);
    }

}
