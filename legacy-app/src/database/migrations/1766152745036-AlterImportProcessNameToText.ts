import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterImportProcessNameToText1766152745036 implements MigrationInterface {
  public name = 'AlterImportProcessNameToText1766152745036';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "import_process" ALTER COLUMN "process_name" TYPE text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "import_process" ALTER COLUMN "process_name" TYPE character varying(255)`);
  }
}
