import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity facts (description, active_ingredient, generic) were
 * denormalized here for a build-base-products aggregation that never
 * shipped. The princípio ativo relationship is now OURS — curated in
 * shared_catalog.base_product (/admin/catalog/base-products), never
 * synced from the tenant's ERP — and every tenant read crosses into it
 * by EAN, so the per-tenant copies go away.
 */
export class DropProductIdentityColumns1700000000022
  implements MigrationInterface
{
  public name = 'DropProductIdentityColumns1700000000022';

  public async up(q: QueryRunner): Promise<void> {
    // Backfill before dropping: the tenant copies were refreshed by every
    // sync (and were tenant-editable) while base_product froze at first
    // insert — the per-tenant value can be fresher. NULL-guarded so the
    // first tenant migrated wins and re-runs are no-ops.
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

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE product
        ADD COLUMN description text,
        ADD COLUMN active_ingredient text,
        ADD COLUMN generic boolean NOT NULL DEFAULT false
    `);
  }
}
