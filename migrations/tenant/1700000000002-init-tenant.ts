import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitTenant1700000000002 implements MigrationInterface {
  public name = 'InitTenant1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_competitor_origin (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        origin text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        config jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_tco_origin CHECK (origin IN ('DROGAL','DROGASIL','PAGUE_MENOS','IKESAKI','MICHELASSI'))
      );
      CREATE UNIQUE INDEX "UQ_TENANT_COMP_ORIGIN" ON tenant_competitor_origin(origin);
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        external_id text,
        name text,
        active boolean NOT NULL DEFAULT true,
        price numeric(12,2),
        cost numeric(12,4),
        average_unit_cost numeric(12,4),
        unit_sale_price numeric(12,2),
        supplier text,
        receipt_date date,
        monitored boolean NOT NULL DEFAULT false,
        classification_id uuid,
        deals jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_PRODUCT_EAN" ON tenant_product(ean);
      CREATE UNIQUE INDEX "UQ_TENANT_PRODUCT_EXTERNAL_ID"
        ON tenant_product(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX "IX_TENANT_PRODUCT_CLASSIFICATION" ON tenant_product(classification_id);
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_product_override (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        origin text NOT NULL,
        monitored boolean NOT NULL DEFAULT false,
        notes text,
        overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_OVERRIDE_EAN_ORIGIN" ON tenant_product_override(ean, origin);
      CREATE INDEX "IX_TENANT_OVERRIDE_EAN" ON tenant_product_override(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE active_ingredient (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        mat numeric(12,4),
        mat_updated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_ACTIVE_INGREDIENT_NAME" ON active_ingredient(name);
    `);

    await queryRunner.query(`
      CREATE TABLE classification (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        parent_id uuid,
        visible boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_CLASSIFICATION_PARENT" ON classification(parent_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        description text,
        target_price numeric(12,2),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_OFFER_BOOK_EAN" ON offer_book(ean);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_info (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_OFFER_BOOK_INFO_BOOK" ON offer_book_info(offer_book_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_pricing_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        expression text NOT NULL,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_price_lock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        offer_book_id uuid NOT NULL REFERENCES offer_book(id) ON DELETE CASCADE,
        locked_price numeric(12,2) NOT NULL,
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_PRICE_LOCK_BOOK" ON offer_book_price_lock(offer_book_id);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text,
        conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_product (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_RULE_PRODUCT" ON offer_book_rule_product(rule_id, ean);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_execution_report (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        status text NOT NULL,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_report_status CHECK (status IN ('running','completed','failed'))
      );
      CREATE INDEX "IX_REPORT_RULE_STARTED" ON offer_book_rule_execution_report(rule_id, started_at);
    `);

    await queryRunner.query(`
      CREATE TABLE offer_book_rule_execution_report_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_id uuid NOT NULL REFERENCES offer_book_rule_execution_report(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        old_price numeric(12,2),
        new_price numeric(12,2),
        outcome text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_REPORT_ITEM_REPORT" ON offer_book_rule_execution_report_item(report_id);
    `);

    await queryRunner.query(`
      CREATE TABLE price_rounding_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE price_rounding_decimal_range (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES price_rounding_rule(id) ON DELETE CASCADE,
        min_decimal numeric(5,2) NOT NULL,
        max_decimal numeric(5,2) NOT NULL,
        target_decimal numeric(5,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_DECIMAL_RANGE_RULE" ON price_rounding_decimal_range(rule_id);
    `);

    await queryRunner.query(`
      CREATE TABLE scheduling (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        cron_expression text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE status_settings (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
    `);

    // Per-tenant subsidiary label lookup. The sync-base-product-stock
    // step imports every store's stock from the ERP regardless of what
    // is configured here; this table only carries human-readable names
    // (e.g. "LOJA 1") so the UI can label rows. Replaces the legacy
    // hardcoded SubsidiaryMaping enum.
    await queryRunner.query(`
      CREATE TABLE tenant_subsidiary (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        external_id bigint NOT NULL,
        name text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_SUBSIDIARY_EXTERNAL_ID"
        ON tenant_subsidiary(external_id);
    `);

    // Per-tenant ERP stock, keyed on (ean, subsidiary_external_id). No
    // FK to tenant_subsidiary so unknown stores can still land — the
    // operator labels them later by inserting a tenant_subsidiary row.
    await queryRunner.query(`
      CREATE TABLE tenant_product_stock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        ean bigint NOT NULL,
        subsidiary_external_id bigint NOT NULL,
        quantity int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE UNIQUE INDEX "UQ_TENANT_PRODUCT_STOCK_EAN_SUBSIDIARY"
        ON tenant_product_stock(ean, subsidiary_external_id);
      CREATE INDEX "IX_TENANT_PRODUCT_STOCK_EAN" ON tenant_product_stock(ean);
    `);

    // Deferred FKs (tables created out of dependency order).
    await queryRunner.query(`
      ALTER TABLE tenant_product
      ADD CONSTRAINT fk_tenant_product_classification
      FOREIGN KEY (classification_id)
      REFERENCES classification(id)
      ON DELETE SET NULL;
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error('Tenant template migrations are not reversible. Use tenant offboarding to drop the schema.');
  }
}
