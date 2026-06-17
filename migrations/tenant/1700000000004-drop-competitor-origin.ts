import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the per-tenant tenant_competitor_origin table. Its rows were
 * copied into core.tenant_competitor_origin by the core migration
 * (1700000000030), which runs before this one on deploy (app migrations
 * complete before per-tenant migrations are enqueued).
 */
export class DropCompetitorOrigin1700000000004 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS tenant_competitor_origin`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS tenant_competitor_origin (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        origin text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_tco_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_TENANT_COMP_ORIGIN" ON tenant_competitor_origin(origin);
    `);
  }
}
