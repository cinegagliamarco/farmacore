import { MigrationInterface, QueryRunner } from "typeorm";

export class AddProductErrorColumn1761659016745 implements MigrationInterface {
    name = 'AddProductErrorColumn1761659016745'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product" ADD "error" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "error"`);
    }

}
