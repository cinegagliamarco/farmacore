import { MigrationInterface, QueryRunner } from 'typeorm';

export class PipelineRunDispatchCounters1700000000011
  implements MigrationInterface
{
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE core.pipeline_run ADD COLUMN batches_planned int`,
    );
    await qr.query(
      `ALTER TABLE core.pipeline_run ADD COLUMN batches_done int NOT NULL DEFAULT 0`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE core.pipeline_run DROP COLUMN batches_done`);
    await qr.query(`ALTER TABLE core.pipeline_run DROP COLUMN batches_planned`);
  }
}
