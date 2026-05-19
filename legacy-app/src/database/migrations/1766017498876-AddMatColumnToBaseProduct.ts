import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMatColumnToBaseProduct1766017498876 implements MigrationInterface {
  public name = 'AddMatColumnToBaseProduct1766017498876';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "mat" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "mat"`);
  }
}
