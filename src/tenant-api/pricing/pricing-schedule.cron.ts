import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantService } from '../../tenant/tenant.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { PricingApplyService } from './pricing-apply.service';
import { PricingScheduleService } from './pricing-schedule.service';

/**
 * Dispara agendamentos vencidos (one-shot). Singleton na API (guarda
 * WORKER_MODE), por minuto. Por tenant, abre a transação e reusa o apply em
 * massa com os preços CONGELADOS — revalidados na hora pelo PricingApplyService
 * (`idempotencyKey = sched:<id>` torna o disparo idempotente). FOR UPDATE SKIP
 * LOCKED no claim evita disparo duplicado entre réplicas.
 */
@Injectable()
export class PricingScheduleCron {
  private readonly logger = new Logger(PricingScheduleCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly tx: TenantTransactionService,
    private readonly schedules: PricingScheduleService,
    private readonly apply: PricingApplyService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      if (t.slug === 'system') continue;
      try {
        await this.fireForTenant(t.slug, t.schemaName);
      } catch (err) {
        // Tenant sem a tabela (não migrado) ou erro isolado não derruba os demais.
        this.logger.debug(
          `schedule fire skipped for ${t.slug}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async fireForTenant(slug: string, schemaName: string): Promise<void> {
    await this.tx.runWithTenant(schemaName, async (em) => {
      const due = await this.schedules.claimDue(em);
      for (const s of due) {
        const run = await this.apply.apply(em, slug, s.requestedBy, {
          idempotencyKey: `sched:${s.id}`,
          mode: 'agora',
          items: s.items,
        });
        await this.schedules.markFired(em, s.id, run.applyRunId);
        this.logger.log(
          `schedule ${s.id} fired for ${slug} → apply run ${run.applyRunId}`,
        );
      }
    });
  }
}
