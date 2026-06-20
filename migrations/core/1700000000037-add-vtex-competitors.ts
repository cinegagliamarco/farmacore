import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds four VTEX competitor origins (Drogaria Pacheco, Drogaria São Paulo,
 * Drogaria Venâncio, Farmácia Indiana) to the closed origin lists.
 *
 * `origin` is plain text guarded by two CHECK constraints (no PG enum):
 * `chk_product_origin` on shared_catalog.product and `chk_core_tco_origin`
 * on core.tenant_competitor_origin. Both must list the new values or any
 * scrape upsert / tenant config row with a new origin is rejected.
 *
 * Existing tenants are backfilled with one disabled row per new origin so
 * the admin bulk-update can enable them (it only UPDATEs existing rows).
 * New tenants get these automatically via the onboarding seed loop, which
 * iterates Object.values(CompetitorOrigin).
 *
 * shared_catalog.product is the hot, continuously-written table, so its
 * CHECK is re-added `NOT VALID`: widening can never fail on existing rows,
 * and NOT VALID skips the full-table scan that a validating ADD would run
 * under ACCESS EXCLUSIVE (which would stall the scrape pipeline on deploy).
 * The constraint is still enforced for every new write. The small
 * core.tenant_competitor_origin table is validated normally.
 */
const ALL_ORIGINS =
  "'DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI','PACHECO','SAO_PAULO','VENANCIO','INDIANA'";
const ORIGINAL_ORIGINS =
  "'DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'";
const NEW_ORIGINS = ['PACHECO', 'SAO_PAULO', 'VENANCIO', 'INDIANA'];

export class AddVtexCompetitors1700000000037 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE shared_catalog.product DROP CONSTRAINT IF EXISTS chk_product_origin;
      ALTER TABLE shared_catalog.product
        ADD CONSTRAINT chk_product_origin CHECK (origin IN (${ALL_ORIGINS})) NOT VALID;
      ALTER TABLE core.tenant_competitor_origin DROP CONSTRAINT IF EXISTS chk_core_tco_origin;
      ALTER TABLE core.tenant_competitor_origin
        ADD CONSTRAINT chk_core_tco_origin CHECK (origin IN (${ALL_ORIGINS}));
    `);

    for (const origin of NEW_ORIGINS) {
      await q.query(
        `INSERT INTO core.tenant_competitor_origin (tenant_id, origin, enabled)
         SELECT id, $1, false FROM core.tenant
         ON CONFLICT (tenant_id, origin) DO NOTHING`,
        [origin],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Rows with the new origins must go before the CHECK is narrowed back,
    // or ADD CONSTRAINT fails on the leftover values.
    await q.query(
      `DELETE FROM core.tenant_competitor_origin WHERE origin = ANY($1)`,
      [NEW_ORIGINS],
    );
    await q.query(`DELETE FROM shared_catalog.product WHERE origin = ANY($1)`, [
      NEW_ORIGINS,
    ]);
    await q.query(`
      ALTER TABLE shared_catalog.product DROP CONSTRAINT IF EXISTS chk_product_origin;
      ALTER TABLE shared_catalog.product
        ADD CONSTRAINT chk_product_origin CHECK (origin IN (${ORIGINAL_ORIGINS}));
      ALTER TABLE core.tenant_competitor_origin DROP CONSTRAINT IF EXISTS chk_core_tco_origin;
      ALTER TABLE core.tenant_competitor_origin
        ADD CONSTRAINT chk_core_tco_origin CHECK (origin IN (${ORIGINAL_ORIGINS}));
    `);
  }
}
