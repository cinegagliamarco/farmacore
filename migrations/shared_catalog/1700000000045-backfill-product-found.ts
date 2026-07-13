import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfills found=false for historical not-found rows and drops the stale
 * `found` key from their metadata. Only the not-found subset is touched
 * (metadata->>'found' = 'false'): found=true rows already read the column's
 * DEFAULT and shed their leftover metadata.found key on the next scrape
 * (upsertScrapes overwrites metadata wholesale).
 *
 * No DDL here, so this takes only row locks on the not-found subset — it does
 * NOT block reads of the hot table the way the ADD COLUMN in migration 044
 * would if the backfill shared its transaction.
 */
export class BackfillProductFound1700000000045 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE shared_catalog.product
         SET found = false,
             metadata = metadata - 'found'
       WHERE metadata->>'found' = 'false'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE shared_catalog.product
         SET metadata = jsonb_set(metadata, '{found}', to_jsonb(found))
       WHERE found = false
    `);
  }
}
