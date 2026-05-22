import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSharedCatalog1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS shared_catalog`);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.base_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        description text,
        active_ingredient text,
        generic boolean NOT NULL DEFAULT false,
        height numeric(10,4),
        length numeric(10,4),
        width numeric(10,4),
        weight numeric(10,3),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_BASE_PRODUCT_EAN" ON shared_catalog.base_product(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        origin text NOT NULL,
        external_id text NOT NULL,
        name text,
        url text,
        price numeric(12,2),
        unit_sale_price numeric(12,2),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_product_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE INDEX "IX_PRODUCT_EAN_ORIGIN" ON shared_catalog.product(ean, origin);
      CREATE UNIQUE INDEX "UQ_PRODUCT_EXTERNAL" ON shared_catalog.product(origin, external_id);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product_image (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES shared_catalog.product(id) ON DELETE CASCADE,
        url text NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRODUCT_IMAGE_PRODUCT" ON shared_catalog.product_image(product_id);
    `);

    await queryRunner.query(`
      CREATE TABLE shared_catalog.product_stock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        product_id uuid NOT NULL REFERENCES shared_catalog.product(id) ON DELETE CASCADE,
        quantity int NOT NULL,
        captured_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRODUCT_STOCK_PRODUCT_CAPTURED" ON shared_catalog.product_stock(product_id, captured_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS shared_catalog CASCADE`);
  }
}
