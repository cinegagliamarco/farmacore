import { MigrationInterface, QueryRunner } from 'typeorm';

export class PipelineOutbox1700000000020 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE core.pipeline_outbox (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        pipeline_run_id uuid NOT NULL,
        tenant_id text NOT NULL,
        routing_key text NOT NULL,
        message jsonb NOT NULL,
        attempts int NOT NULL DEFAULT 0,
        published_at timestamptz,
        -- Set when a publisher claims the row. Cleared semantically by
        -- published_at filtering — never read again after publish succeeds.
        -- A stale claimed_at (older than CLAIM_GRACE_MS) lets another
        -- tick reclaim the row, covering crashed publishers.
        claimed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      -- partial index for the publisher's "what's pending" scan
      CREATE INDEX "IX_PIPELINE_OUTBOX_PENDING"
        ON core.pipeline_outbox(created_at) WHERE published_at IS NULL;
      CREATE INDEX "IX_PIPELINE_OUTBOX_RUN" ON core.pipeline_outbox(pipeline_run_id);
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE core.pipeline_outbox`);
  }
}
