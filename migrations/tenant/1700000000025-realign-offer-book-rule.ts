import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 2 do offer-book-rules: a regra deixa de ser um stub genérico
 * (`conditions` jsonb) e passa a ser o conjunto de regras aplicado a um
 * caderno de ofertas já existente. `offer_book_info_id` é o idCadernoOferta
 * (o `external_id` do tenant_offer_campaign / offer_book que o
 * GET /offer-campaigns lista) — não é FK para a tabela `offer_book_info`
 * (essa é metadata por-EAN). Uma regra por caderno (unique).
 *
 * offer_book_pricing_rule e offer_book_price_lock eram stubs pendurados no
 * offer_book errado; são recriados pendurados na regra. Tabelas sem escrita
 * até aqui (não havia endpoint de criação), então drop/recreate é seguro.
 */
export class RealignOfferBookRule1700000000025 implements MigrationInterface {
  public name = 'RealignOfferBookRule1700000000025';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS offer_book_price_lock`);
    await q.query(`DROP TABLE IF EXISTS offer_book_pricing_rule`);

    await q.query(`
      ALTER TABLE offer_book_rule
        DROP COLUMN name,
        DROP COLUMN description,
        DROP COLUMN conditions,
        DROP COLUMN enabled,
        ADD COLUMN offer_book_info_id bigint NOT NULL,
        ADD COLUMN calculation_base_type text NOT NULL,
        ADD COLUMN price_base_sources jsonb,
        ADD COLUMN classifications jsonb,
        ADD COLUMN schedule_enabled boolean NOT NULL DEFAULT false,
        ADD COLUMN scheduled_days jsonb,
        ADD COLUMN apply_price_rounding boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT chk_obr_calc_base_type
          CHECK (calculation_base_type IN
            ('COMPETITIVE_PRICE','SALE_PRICE','OFFER_PRICE'));
      CREATE UNIQUE INDEX "UQ_OFFER_BOOK_RULE_INFO"
        ON offer_book_rule(offer_book_info_id);
    `);

    await q.query(`
      CREATE TABLE offer_book_pricing_rule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        classifications jsonb,
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
        CONSTRAINT chk_obpr_action_type
          CHECK (action_type IN ('DISCOUNT','INCREASE'))
      );
      CREATE INDEX "IX_OFFER_BOOK_PRICING_RULE_RULE"
        ON offer_book_pricing_rule(rule_id);
    `);

    await q.query(`
      CREATE TABLE offer_book_price_lock (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        classifications jsonb,
        min_margin numeric(12,2) NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz
      );
      CREATE INDEX "IX_OFFER_BOOK_PRICE_LOCK_RULE"
        ON offer_book_price_lock(rule_id);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS offer_book_price_lock`);
    await q.query(`DROP TABLE IF EXISTS offer_book_pricing_rule`);

    await q.query(`
      DROP INDEX IF EXISTS "UQ_OFFER_BOOK_RULE_INFO";
      ALTER TABLE offer_book_rule
        DROP CONSTRAINT IF EXISTS chk_obr_calc_base_type,
        DROP COLUMN offer_book_info_id,
        DROP COLUMN calculation_base_type,
        DROP COLUMN price_base_sources,
        DROP COLUMN classifications,
        DROP COLUMN schedule_enabled,
        DROP COLUMN scheduled_days,
        DROP COLUMN apply_price_rounding,
        ADD COLUMN name text NOT NULL DEFAULT '',
        ADD COLUMN description text,
        ADD COLUMN conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN enabled boolean NOT NULL DEFAULT true;
    `);

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
  }
}
