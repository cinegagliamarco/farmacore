import { MigrationInterface, QueryRunner } from 'typeorm';

export class PipelineRunLastPublishedBatchSeq1700000000041
  implements MigrationInterface
{
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE core.pipeline_run
         ADD COLUMN last_published_batch_seq int NOT NULL DEFAULT 0`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE core.pipeline_run DROP COLUMN last_published_batch_seq`,
    );
  }
}
