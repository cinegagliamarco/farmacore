import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes the `found` flag on shared_catalog.product from a metadata jsonb
 * key to a first-class boolean column. found=false means the EAN isn't sold
 * on that origin; the daily import now skips those (ean, origin) pairs
 * permanently instead of re-scraping them. metadata keeps only real product
 * data (image, description, observation, isPbm, ...).
 *
 * shared_catalog.product is the hot, continuously-written table, so we add
 * the column with a default — on PG11+ `ADD COLUMN ... DEFAULT` is a
 * metadata-only change (no table rewrite, no long ACCESS EXCLUSIVE lock).
 * The backfill only rewrites rows that carried a `found` key.
 */
export class AddProductFound1700000000038 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE shared_catalog.product ADD COLUMN found boolean NOT NULL DEFAULT true`,
    );
    await q.query(`
      UPDATE shared_catalog.product
         SET found = COALESCE((metadata->>'found')::boolean, true),
             metadata = metadata - 'found'
       WHERE metadata ? 'found'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE shared_catalog.product
         SET metadata = jsonb_set(metadata, '{found}', to_jsonb(found))
    `);
    await q.query(`ALTER TABLE shared_catalog.product DROP COLUMN found`);
  }
}
