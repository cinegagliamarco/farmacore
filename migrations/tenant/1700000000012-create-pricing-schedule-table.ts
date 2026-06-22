import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agendamento de aplicação de preço (Fase 3.2). One-shot: dispara em `run_at`
 * com os preços APROVADOS congelados em `items`. Ao disparar, o cron cria um
 * pricing_apply_run (apply_run_id) e marca `fired`. Recorrência/recálculo ficam
 * para depois (decisão de negócio — ver plano §17.9).
 */
export class CreatePricingScheduleTable1700000000012
  implements MigrationInterface
{
  public name = 'CreatePricingScheduleTable1700000000012';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE pricing_schedule (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        run_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        requested_by uuid,
        items jsonb NOT NULL DEFAULT '[]'::jsonb,
        apply_run_id uuid,
        fired_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT chk_psch_status
          CHECK (status IN ('pending','fired','cancelled'))
      );
      CREATE INDEX "IX_PRICING_SCHEDULE_STATUS_RUN_AT"
        ON pricing_schedule(status, run_at);
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS pricing_schedule`);
  }
}
