import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity facts (description, active_ingredient, generic) were
 * denormalized here for a build-base-products aggregation that never
 * shipped. The princípio ativo relationship is now OURS — curated in
 * shared_catalog.base_product (/admin/catalog/base-products), never
 * synced from the tenant's ERP — and every tenant read crosses into it
 * by EAN, so the per-tenant copies go away.
 *
 * ROLLOUT: run only after every machine is on the release that removed
 * the columns from ProductEntity — old code still SELECTs/UPSERTs them
 * and breaks against the post-drop schema. Curation done before ALL
 * tenants have migrated can be overwritten by a later tenant's backfill
 * (the guards only see NULL/false, not "an admin touched this").
 */
export class DropProductIdentityColumns1700000000022
  implements MigrationInterface
{
  public name = 'DropProductIdentityColumns1700000000022';

  public async up(q: QueryRunner): Promise<void> {
    // Tenant migrations run concurrently (RMQ fan-out) and the backfills
    // below mass-update the SHARED base_product in arbitrary row order —
    // the same cross-batch deadlock the ean-sorted insert path defends
    // against. Serialize just this section across tenants.
    await q.query(
      `SELECT pg_advisory_xact_lock(hashtext('bp-identity-backfill'))`,
    );
    // The bp seeding is decoupled/best-effort (see BaseProductProjector),
    // so a tenant EAN can exist without a bp row; without this INSERT its
    // identity would vanish with the DROP below. ON CONFLICT guards the
    // race with a live sync insert.
    await q.query(`
      INSERT INTO shared_catalog.base_product
        (ean, description, active_ingredient, generic)
      SELECT p.ean, p.description, p.active_ingredient, p.generic
        FROM product p
       WHERE NOT EXISTS (
         SELECT 1 FROM shared_catalog.base_product bp WHERE bp.ean = p.ean
       )
      ON CONFLICT (ean) DO NOTHING
    `);
    // Backfill before dropping: the tenant copies were refreshed by every
    // sync (and were tenant-editable) while base_product froze at first
    // insert — the per-tenant value can be fresher. Text columns are
    // NULL-guarded (first non-null wins; a tenant value that DIVERGES from
    // a non-null bp value is intentionally discarded — the cadastre is the
    // source of truth now, corrections go through the admin). `generic` is
    // an OR across tenants: any tenant true flips the shared flag, never
    // back. Re-runs are no-ops.
    await q.query(`
      UPDATE shared_catalog.base_product bp
         SET active_ingredient = p.active_ingredient, updated_at = now()
        FROM product p
       WHERE p.ean = bp.ean
         AND bp.active_ingredient IS NULL
         AND p.active_ingredient IS NOT NULL
    `);
    await q.query(`
      UPDATE shared_catalog.base_product bp
         SET generic = true, updated_at = now()
        FROM product p
       WHERE p.ean = bp.ean AND p.generic IS TRUE AND bp.generic IS FALSE
    `);
    await q.query(`
      UPDATE shared_catalog.base_product bp
         SET description = p.description, updated_at = now()
        FROM product p
       WHERE p.ean = bp.ean
         AND bp.description IS NULL
         AND p.description IS NOT NULL
    `);
    await q.query(`
      ALTER TABLE product
        DROP COLUMN IF EXISTS description,
        DROP COLUMN IF EXISTS active_ingredient,
        DROP COLUMN IF EXISTS generic
    `);
  }

  /** Schema-only revert: the dropped per-tenant data is unrecoverable and
   *  the base_product backfill is not unwound. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE product
        ADD COLUMN description text,
        ADD COLUMN active_ingredient text,
        ADD COLUMN generic boolean NOT NULL DEFAULT false
    `);
  }
}
