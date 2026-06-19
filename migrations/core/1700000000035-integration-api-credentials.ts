import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-tenant A7Pharma REST API credentials for write-back (price/offer
 * edits go over HTTP, separate from the read-only DB connection). Stored
 * alongside the DB connection; api_key is encrypted like the DB password.
 */
export class IntegrationApiCredentials1700000000035
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE core.integration_database_connection
        ADD COLUMN IF NOT EXISTS api_base_url text,
        ADD COLUMN IF NOT EXISTS api_key_encrypted bytea
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE core.integration_database_connection
        DROP COLUMN IF EXISTS api_base_url,
        DROP COLUMN IF EXISTS api_key_encrypted
    `);
  }
}
