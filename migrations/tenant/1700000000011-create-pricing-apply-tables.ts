import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aplicação de preço em massa (Fase 3). `pricing_apply_run` é o run (1 por POST
 * /pricing/apply, id = pipelineRunId do fan-in em core.pipeline_run);
 * `pricing_apply_item` guarda o snapshot + resultado por-EAN (preço anterior
 * para auditoria/undo). Schema do tenant, resolvido pelo search_path.
 */
export class CreatePricingApplyTables1700000000011
  implements MigrationInterface
{
  public name = 'CreatePricingApplyTables1700000000011';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE pricing_apply_run (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        idempotency_key text NOT NULL,
        mode text NOT NULL DEFAULT 'agora',
        requested_by uuid,
        status text NOT NULL DEFAULT 'pending',
        total int NOT NULL DEFAULT 0,
        applied int NOT NULL DEFAULT 0,
        skipped int NOT NULL DEFAULT 0,
        failed int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_par_mode CHECK (mode IN ('agora','agendado')),
        CONSTRAINT chk_par_status
          CHECK (status IN ('pending','running','done','failed'))
      );
      CREATE UNIQUE INDEX "UQ_PRICING_APPLY_RUN_IDEMPOTENCY"
        ON pricing_apply_run(idempotency_key);
    `);

    await q.query(`
      CREATE TABLE pricing_apply_item (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        apply_run_id uuid NOT NULL
          REFERENCES pricing_apply_run(id) ON DELETE CASCADE,
        batch_seq int,
        ean text NOT NULL,
        target text NOT NULL,
        price numeric(12,2) NOT NULL,
        caderno_id bigint,
        price_old_sell numeric(12,2),
        price_old_offer numeric(12,2),
        basis text,
        rule_id uuid,
        cost_at_apply numeric(12,4),
        status text NOT NULL DEFAULT 'pending',
        reason text,
        erp_result text,
        applied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_pai_target CHECK (target IN ('precoVenda','precoOferta')),
        CONSTRAINT chk_pai_status
          CHECK (status IN ('pending','applied','skipped','failed'))
      );
      CREATE INDEX "IX_PRICING_APPLY_ITEM_RUN_BATCH"
        ON pricing_apply_item(apply_run_id, batch_seq);
      CREATE INDEX "IX_PRICING_APPLY_ITEM_RUN_STATUS"
        ON pricing_apply_item(apply_run_id, status);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS pricing_apply_item`);
    await q.query(`DROP TABLE IF EXISTS pricing_apply_run`);
  }
}
