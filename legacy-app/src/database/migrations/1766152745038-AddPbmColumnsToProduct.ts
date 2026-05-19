import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPbmColumnsToProduct1766152745038 implements MigrationInterface {
  public name = 'AddPbmColumnsToProduct1766152745038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "is_pbm" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "product" ADD COLUMN "van" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "van"`);
    await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "is_pbm"`);
  }
}
