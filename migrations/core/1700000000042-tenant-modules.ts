import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantModules1700000000042 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TABLE core.tenant
         ADD COLUMN modules text[] NOT NULL DEFAULT '{}'`,
    );
    // Tenants existentes mantêm acesso a tudo; restringir é ação explícita
    // do system admin via PUT /admin/tenants/:slug/modules.
    await qr.query(
      `UPDATE core.tenant
          SET modules = ARRAY[
            'crossed-products',
            'active-ingredient-analysis',
            'pricing-rules',
            'offer-book-rules',
            'strategic-pricing'
          ]`,
    );
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE core.tenant DROP COLUMN modules`);
  }
}
