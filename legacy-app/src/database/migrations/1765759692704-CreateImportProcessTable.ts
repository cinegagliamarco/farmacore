import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateImportProcessTable1765759692704 implements MigrationInterface {
  public name = 'CreateImportProcessTable1765759692704';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_process" (
        "id" SERIAL NOT NULL,
        "finished" boolean NOT NULL DEFAULT false,
        "process_name" character varying NOT NULL,
        "inserted_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_date" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_IMPORT_PROCESS" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "import_process"`);
  }
}
