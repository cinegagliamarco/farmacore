import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { TenantService } from '../../tenant/tenant.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { ScheduleItem } from '../../database/entities/tenant/pricing-schedule.entity';
import { ApplyItemDto } from './dto/apply.dto';
import { PricingApplyService } from './pricing-apply.service';
import { PricingScheduleService } from './pricing-schedule.service';
import { PricingSuggestionsService } from './pricing-suggestions.service';

/** Tags a schedule-processing error with the claimed id + run_at so the
 *  cron can park exactly the claim that failed. */
class ScheduleFireError extends Error {
  constructor(
    public readonly scheduleId: string,
    public readonly claimedRunAt: Date,
    err: unknown,
  ) {
    super(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Dispara agendamentos vencidos. Singleton na API (guarda WORKER_MODE), por
 * minuto. Uma transação POR agendamento reusando o apply em massa. One-shot usa
 * os preços CONGELADOS; `recalc` recalcula pelo motor no disparo; `cronExpr`
 * re-arma para a próxima ocorrência. `idempotencyKey` inclui o run_at: cada
 * ocorrência é única, mas o reenvio do mesmo disparo é no-op. FOR UPDATE SKIP
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
    private readonly suggestions: PricingSuggestionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { timeZone: 'UTC' })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      // Módulo revogado pausa os agendamentos (ficam pending; voltam a
      // disparar se o admin reabilitar).
      if (t.slug === 'system' || !t.modules.includes(ModuleCode.PRICING_RULES))
        continue;
      try {
        await this.fireForTenant(t.slug, t.schemaName);
      } catch (err) {
        // Tenant sem a tabela (não migrado) ou erro isolado não derruba os demais.
        this.logger.warn(
          `schedule fire skipped for ${t.slug}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * One transaction PER schedule: an apply that throws (e.g. circuit breaker
   * 422) must not roll back the markFired of earlier schedules nor make the
   * cron retry the whole batch forever — the failing one is parked as 'failed'
   * and the loop moves on.
   */
  private async fireForTenant(slug: string, schemaName: string): Promise<void> {
    // Recalc snapshot computed once per tenant (the engine scans the whole
    // catalog), on the first schedule that needs it.
    let suggested: Map<
      string,
      { target: ApplyItemDto['target']; price: number }
    > | null = null;
    for (;;) {
      try {
        const fired = await this.tx.runWithTenant(schemaName, async (em) => {
          const s = await this.schedules.claimNext(em);
          if (!s) return false;
          try {
            if (s.recalc && !suggested) {
              suggested = await this.suggestions.priceMap(em, slug);
            }
            const items =
              s.recalc && suggested
                ? this.recalcItems(s.items, suggested)
                : s.items;
            const runId = items.length
              ? (
                  await this.apply.apply(em, slug, s.requestedBy, {
                    idempotencyKey: `sched:${s.id}:${new Date(s.runAt).toISOString()}`,
                    mode: 'agora',
                    items,
                  })
                ).applyRunId
              : null;
            if (s.cronExpr)
              await this.schedules.reArm(em, s.id, s.cronExpr, runId);
            else await this.schedules.markFired(em, s.id, runId);
            this.logger.log(
              `schedule ${s.id} fired for ${slug} → apply run ${runId ?? 'vazio'}`,
            );
          } catch (err) {
            throw new ScheduleFireError(s.id, s.runAt, err);
          }
          return true;
        });
        if (!fired) return;
      } catch (err) {
        // claim/infra error — fire() logs it and moves to the next tenant
        if (!(err instanceof ScheduleFireError)) throw err;
        this.logger.warn(
          `schedule ${err.scheduleId} failed for ${slug}: ${err.message}`,
        );
        try {
          await this.tx.runWithTenant(schemaName, (em) =>
            this.schedules.markFailed(em, err.scheduleId, err.claimedRunAt),
          );
        } catch (parkErr) {
          // Can't park it (e.g. status CHECK not yet migrated): end the tick —
          // looping on would re-claim the same schedule forever. Next tick retries.
          this.logger.warn(
            `markFailed(${err.scheduleId}) failed for ${slug}: ${parkErr instanceof Error ? parkErr.message : parkErr}`,
          );
          return;
        }
      }
    }
  }

  /**
   * Troca o congelado pela sugestão fresca do motor (preço E alvo — o motor
   * decide venda vs oferta, não o item agendado); descarta item sem sugestão.
   */
  private recalcItems(
    items: ScheduleItem[],
    suggested: Map<string, { target: ApplyItemDto['target']; price: number }>,
  ): ApplyItemDto[] {
    return items.flatMap((i) => {
      const s = suggested.get(i.ean);
      return s === undefined
        ? []
        : [
            {
              ean: i.ean,
              target: s.target,
              price: s.price,
              cadernoId: i.cadernoId,
            },
          ];
    });
  }
}
