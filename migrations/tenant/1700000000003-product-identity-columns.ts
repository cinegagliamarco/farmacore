import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Plan 10 phase 1: tenant `product` carries the base-product identity
 * (description / active_ingredient / generic) so the system
 * "build base products" routine can aggregate base_product from tenant
 * rows instead of re-reading every tenant's ERP.
 */
export class ProductIdentityColumns1700000000003 implements MigrationInterface {
  public name = 'ProductIdentityColumns1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product
        ADD COLUMN description text,
        ADD COLUMN active_ingredient text,
        ADD COLUMN generic boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE product
        DROP COLUMN description,
        DROP COLUMN active_ingredient,
        DROP COLUMN generic
    `);
  }
}
