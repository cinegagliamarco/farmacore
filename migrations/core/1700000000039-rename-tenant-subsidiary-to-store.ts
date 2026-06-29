import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames core.tenant_subsidiary -> core.tenant_store (and its unique index)
 * to standardize on "store" across the codebase. Data is preserved — this is
 * a pure rename.
 */
export class RenameTenantSubsidiaryToStore1700000000039
  implements MigrationInterface
{
  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE IF EXISTS core.tenant_subsidiary RENAME TO tenant_store`,
    );
    await q.query(
      `ALTER INDEX IF EXISTS core."UQ_TENANT_SUBSIDIARY_EXTERNAL_ID"
         RENAME TO "UQ_TENANT_STORE_EXTERNAL_ID"`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER INDEX IF EXISTS core."UQ_TENANT_STORE_EXTERNAL_ID"
         RENAME TO "UQ_TENANT_SUBSIDIARY_EXTERNAL_ID"`,
    );
    await q.query(
      `ALTER TABLE IF EXISTS core.tenant_store RENAME TO tenant_subsidiary`,
    );
  }
}
