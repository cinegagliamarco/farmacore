import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase 3 (execução + relatório) do offer-book-rules — camada de schema.
 *
 * (1) `offer_book_rule.status`: ciclo de vida da execução (mora na regra, como
 *     no legado; único lugar com PARTIALLY_SUCCEEDED). RUNNING é o guard de
 *     concorrência do POST /execute.
 * (2) Realinha os stubs `offer_book_rule_execution_report(_item)` ao modelo
 *     rico: header com contadores/outcome/executed_at + `idempotency_key`
 *     (dedup por execução); item com o snapshot do preview + o **ledger
 *     money-safe** (`apply_status` pending/erp_applied/applied/failed/skipped
 *     + apply_error), que dirige o push à A7 e torna a redelivery idempotente.
 *     O destino `external_id` também fica congelado no item: uma sincronização
 *     de produto entre o POST e o worker não pode redirecionar o preço para
 *     outra embalagem na A7. Tabelas sem
 *     writer até aqui → drop/recreate seguro.
 */
export class OfferBookRuleExecution1700000000026 implements MigrationInterface {
  public name = 'OfferBookRuleExecution1700000000026';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE offer_book_rule
        ADD COLUMN status text NOT NULL DEFAULT 'IDLE',
        ADD COLUMN active_execution_report_id uuid,
        ADD CONSTRAINT chk_obr_status CHECK (status IN
          ('IDLE','RUNNING','SUCCEEDED','PARTIALLY_SUCCEEDED','ERRORED')),
        ADD CONSTRAINT chk_obr_execution_owner CHECK (
          (status = 'RUNNING' AND active_execution_report_id IS NOT NULL)
          OR
          (status <> 'RUNNING' AND active_execution_report_id IS NULL)
        );
    `);

    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report_item`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report`);

    await q.query(`
      CREATE TABLE offer_book_rule_execution_report (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        rule_id uuid NOT NULL REFERENCES offer_book_rule(id) ON DELETE CASCADE,
        offer_book_info_id bigint NOT NULL,
        executed_at timestamptz NOT NULL,
        execution_type text NOT NULL,
        calculation_base_type text NOT NULL,
        total_products int NOT NULL DEFAULT 0,
        products_updated int NOT NULL DEFAULT 0,
        products_skipped int NOT NULL DEFAULT 0,
        outcome text,
        error_message text,
        idempotency_key text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obrer_execution_type
          CHECK (execution_type IN ('MANUAL','SCHEDULED')),
        CONSTRAINT chk_obrer_calc_base_type
          CHECK (calculation_base_type IN
            ('COMPETITIVE_PRICE','SALE_PRICE','OFFER_PRICE')),
        CONSTRAINT chk_obrer_outcome
          CHECK (outcome IS NULL OR outcome IN ('SUCCESS','FAILURE','NO_CHANGES'))
      );
      CREATE INDEX "IX_REPORT_RULE_EXECUTED"
        ON offer_book_rule_execution_report(rule_id, executed_at DESC);
      CREATE UNIQUE INDEX "UQ_REPORT_IDEMPOTENCY"
        ON offer_book_rule_execution_report(idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);

    await q.query(`
      CREATE TABLE offer_book_rule_execution_report_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        report_id uuid NOT NULL
          REFERENCES offer_book_rule_execution_report(id) ON DELETE CASCADE,
        ean bigint NOT NULL,
        external_id text,
        name text NOT NULL,
        classification text NOT NULL,
        base_sale_price numeric(12,2) NOT NULL DEFAULT 0,
        current_price numeric(12,2) NOT NULL DEFAULT 0,
        current_margin numeric(10,2) NOT NULL DEFAULT 0,
        cost numeric(12,4) NOT NULL DEFAULT 0,
        action_type text,
        percentage_value numeric(10,2) NOT NULL DEFAULT 0,
        applied_percentage_value numeric(10,2) NOT NULL DEFAULT 0,
        final_price numeric(12,2) NOT NULL DEFAULT 0,
        new_margin numeric(10,2) NOT NULL DEFAULT 0,
        price_lock_applied boolean NOT NULL DEFAULT false,
        discount_skipped boolean NOT NULL DEFAULT false,
        skipped_no_competitor_price boolean NOT NULL DEFAULT false,
        skipped_price_exceeds_limit boolean NOT NULL DEFAULT false,
        price_rounding_applied boolean NOT NULL DEFAULT false,
        was_updated boolean NOT NULL DEFAULT false,
        apply_status text NOT NULL DEFAULT 'pending',
        apply_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_obreri_action_type
          CHECK (action_type IS NULL OR action_type IN ('DISCOUNT','INCREASE')),
        CONSTRAINT chk_obreri_apply_status
          CHECK (apply_status IN
            ('pending','erp_applied','applied','failed','skipped'))
      );
      CREATE INDEX "IX_REPORT_ITEM_REPORT_STATUS"
        ON offer_book_rule_execution_report_item(report_id, apply_status);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report_item`);
    await q.query(`DROP TABLE IF EXISTS offer_book_rule_execution_report`);

    // Recria os stubs originais da init-tenant.
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

    await q.query(`
      ALTER TABLE offer_book_rule
        DROP CONSTRAINT IF EXISTS chk_obr_execution_owner,
        DROP CONSTRAINT IF EXISTS chk_obr_status,
        DROP COLUMN active_execution_report_id,
        DROP COLUMN status;
    `);
  }
}
