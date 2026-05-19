import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMonitoredColumnToBaseProduct1766152745024 implements MigrationInterface {
  public name = 'AddMonitoredColumnToBaseProduct1766152745024';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" ADD COLUMN "monitored" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "base_product" DROP COLUMN "monitored"`);
  }
}

