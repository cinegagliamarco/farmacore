import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Batch D (§17.3/§17.9): fluxo de aprovação do apply e recorrência/recálculo
 * do agendamento.
 * - pricing_apply_run.approval_status: null = sem aprovação (comportamento
 *   atual); 'pending' aguarda admin; 'approved'/'rejected' decididos.
 * - pricing_schedule.cron_expr: recorrência (re-arma após disparar).
 * - pricing_schedule.recalc: ao disparar, recalcula o preço pelo motor em vez
 *   de usar o congelado.
 */
export class AddApplyApprovalAndScheduleRecurrence1700000000016
  implements MigrationInterface
{
  public name = 'AddApplyApprovalAndScheduleRecurrence1700000000016';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_apply_run ADD COLUMN approval_status text;
      ALTER TABLE pricing_apply_run ADD CONSTRAINT chk_par_approval
        CHECK (approval_status IS NULL
               OR approval_status IN ('pending','approved','rejected'));
      ALTER TABLE pricing_schedule ADD COLUMN cron_expr text;
      ALTER TABLE pricing_schedule
        ADD COLUMN recalc boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE pricing_schedule DROP COLUMN IF EXISTS recalc;
      ALTER TABLE pricing_schedule DROP COLUMN IF EXISTS cron_expr;
      ALTER TABLE pricing_apply_run DROP CONSTRAINT IF EXISTS chk_par_approval;
      ALTER TABLE pricing_apply_run DROP COLUMN IF EXISTS approval_status;
    `);
  }
}
