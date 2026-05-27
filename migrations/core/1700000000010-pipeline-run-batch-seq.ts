import { MigrationInterface, QueryRunner } from 'typeorm';

export class PipelineRunBatchSeq1700000000010 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE core.pipeline_run ADD COLUMN batch_seq int NOT NULL DEFAULT 0`,
    );
    await qr.query(`DROP INDEX IF EXISTS core."UQ_PIPELINE_RUN_RUN_STEP"`);
    await qr.query(
      `CREATE UNIQUE INDEX "UQ_PIPELINE_RUN_RUN_STEP_BATCH" ON core.pipeline_run(pipeline_run_id, step, batch_seq)`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(
      `DROP INDEX IF EXISTS core."UQ_PIPELINE_RUN_RUN_STEP_BATCH"`,
    );
    await qr.query(
      `CREATE UNIQUE INDEX "UQ_PIPELINE_RUN_RUN_STEP" ON core.pipeline_run(pipeline_run_id, step)`,
    );
    await qr.query(`ALTER TABLE core.pipeline_run DROP COLUMN batch_seq`);
  }
}
