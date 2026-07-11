import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `found` boolean column to shared_catalog.product. found=false
 * means the EAN isn't sold on that origin; the daily import skips those
 * (ean, origin) pairs permanently instead of re-scraping them.
 *
 * `ADD COLUMN ... NOT NULL DEFAULT true` is metadata-only on PG11+ (no table
 * rewrite, brief ACCESS EXCLUSIVE). The historical found=false backfill is a
 * separate migration on purpose: keeping it out of this transaction means the
 * ACCESS EXCLUSIVE lock is NOT held across a data rewrite of this hot,
 * continuously-written table.
 */
export class AddProductFound1700000000044 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE shared_catalog.product ADD COLUMN found boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE shared_catalog.product DROP COLUMN found`);
  }
}
