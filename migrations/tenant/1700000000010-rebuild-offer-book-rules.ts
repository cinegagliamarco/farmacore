import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rebuilds the offer_book_rule* family from the init-tenant stubs (which had a
 * placeholder shape: pricing rule = expression/priority, price lock =
 * locked_price/locked_until, thin reports) into the real model ported from the
 * legacy offer-book-rules feature: a named rule that targets products by EAN or
 * classification, owns pricing rules + price locks, and records full per-product
 * execution audits. No tenant has data in these stub tables yet, so this drops
 * and recreates rather than altering. Enums are text + CHECK (the tenant-schema
 * convention — native pg enums don't drop cleanly per schema).
 */
export class RebuildOfferBookRules1700000000010 implements MigrationInterface {
  public name = 'RebuildOfferBookRules1700000000010';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report_item`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_product`);
    await q.query(`DROP TABLE IF EXISTS offer_book_price_lock`);
    await q.query(`DROP TABLE IF EXISTS offer_book_pricing_rule`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule`);

    await q.query(`
      CREATE TABLE offer_book_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name text NOT NULL,
        description text,
        calculation_base_type text NOT NULL,
        price_base_sources text[],
        target_classifications text[],
        apply_price_rounding boolean NOT NULL DEFAULT false,
        enabled boolean NOT NULL DEFAULT true,
        caderno_id bigint,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obr_calc_base CHECK (
          calculation_base_type IN ('SALE_PRICE','OFFER_PRICE','COMPETITIVE_PRICE')
        )
      );
    `);

    await q.query(`
      CREATE TABLE offer_book_pricing_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        classifications text[],
        price_range_min numeric(12,2),
        price_range_max numeric(12,2),
        margin_range_min numeric(12,2),
        margin_range_max numeric(12,2),
        action_type text NOT NULL,
        percentage_value numeric(12,2) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obpr_action CHECK (action_type IN ('DISCOUNT','INCREASE'))
      );
      CREATE INDEX "IX_PRICING_RULE_RULE" ON offer_book_pricing_rule(rule_id);
    `);

    await q.query(`
      CREATE TABLE offer_book_price_lock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        classifications text[],
        min_margin numeric(12,2) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_PRICE_LOCK_RULE" ON offer_book_price_lock(rule_id);
    `);

    await q.query(`
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

    await q.query(`
      CREATE TABLE offer_book_rule_execution_report (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        execution_type text NOT NULL,
        calculation_base_type text NOT NULL,
        started_at timestamptz NOT NULL,
        finished_at timestamptz,
        total_products int NOT NULL DEFAULT 0,
        products_updated int NOT NULL DEFAULT 0,
        products_skipped int NOT NULL DEFAULT 0,
        outcome text,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obrer_exec_type CHECK (execution_type IN ('MANUAL','SCHEDULED')),
        CONSTRAINT chk_obrer_outcome CHECK (
          outcome IS NULL OR
          outcome IN ('SUCCESS','PARTIALLY_SUCCEEDED','FAILURE','NO_CHANGES')
        )
      );
      CREATE INDEX "IX_REPORT_RULE_STARTED" ON offer_book_rule_execution_report(rule_id, started_at);
    `);

    await q.query(`
      CREATE TABLE offer_book_rule_execution_report_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_id uuid NOT NULL REFERENCES offer_book_rule_execution_report(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        name text,
        classification text,
        base_sale_price numeric(12,2),
        current_price numeric(12,2),
        current_margin numeric(12,2),
        cost numeric(12,2),
        action_type text,
        percentage_value numeric(12,2),
        applied_percentage_value numeric(12,2),
        final_price numeric(12,2),
        new_margin numeric(12,2),
        price_lock_applied boolean NOT NULL DEFAULT false,
        discount_skipped boolean NOT NULL DEFAULT false,
        skipped_no_competitor_price boolean NOT NULL DEFAULT false,
        skipped_price_exceeds_limit boolean NOT NULL DEFAULT false,
        price_rounding_applied boolean NOT NULL DEFAULT false,
        was_updated boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obreri_action CHECK (
          action_type IS NULL OR action_type IN ('DISCOUNT','INCREASE')
        )
      );
      CREATE INDEX "IX_REPORT_ITEM_REPORT" ON offer_book_rule_execution_report_item(report_id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report_item`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_product`);
    await q.query(`DROP TABLE IF EXISTS offer_book_price_lock`);
    await q.query(`DROP TABLE IF EXISTS offer_book_pricing_rule`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule`);

    // Restore the init-tenant stub shape so the migration is reversible.
    await q.query(`
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
    await q.query(`
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
    await q.query(`
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
    await q.query(`
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
    await q.query(`
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
    await q.query(`
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
  }
}
