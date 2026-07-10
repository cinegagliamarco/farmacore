import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from 'typeorm';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { TenantService } from '../../tenant/tenant.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { ScheduleItem } from '../../database/entities/tenant/pricing-schedule.entity';
import { ApplyItemDto } from './dto/apply.dto';
import { PricingApplyService } from './pricing-apply.service';
import {
  DueSchedule,
  PricingScheduleService,
} from './pricing-schedule.service';
import {
  PricingSuggestionsService,
  SuggestedPriceMap,
} from './pricing-suggestions.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    for (;;) {
      try {
        const fired = await this.tx.runWithTenant(schemaName, async (em) => {
          const s = await this.schedules.claimNext(em);
          if (!s) return false;
          try {
            const items = s.recalc
              ? this.recalcItems(s.items, await this.recalcMaps(em, slug, s))
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
   * Um mapa recalculado por loja distinta dos itens do agendamento ('' =
   * global), escopado aos EANs agendados — sem o filtro o motor pagaria um
   * passe de CATÁLOGO INTEIRO por loja a cada disparo. Loja com uuid
   * malformado (jsonb manipulado) ou inativa/alheia não paga passe nenhum:
   * fica sem mapa e os itens dela caem no descarte do recalc.
   */
  private async recalcMaps(
    em: EntityManager,
    slug: string,
    s: DueSchedule,
  ): Promise<Map<string, SuggestedPriceMap>> {
    const eansByKey = new Map<string, Set<string>>();
    for (const i of s.items) {
      const key = i.storeId ?? '';
      if (!eansByKey.has(key)) eansByKey.set(key, new Set());
      eansByKey.get(key)!.add(i.ean);
    }
    const maps = new Map<string, SuggestedPriceMap>();
    if (!eansByKey.size) return maps;

    const uuidKeys = [...eansByKey.keys()].filter((k) => k && UUID_RE.test(k));
    const activeRows: Array<{ id: string }> = uuidKeys.length
      ? await em.query(
          `SELECT s.id FROM core.tenant_store s
             JOIN core.tenant t ON t.id = s.tenant_id AND t.slug = $2
            WHERE s.id = ANY($1::uuid[]) AND s.active = true
              AND s.deleted_at IS NULL`,
          [uuidKeys, slug],
        )
      : [];
    const activeIds = new Set(activeRows.map((r) => r.id));
    for (const [key, eans] of eansByKey) {
      if (key && !activeIds.has(key)) {
        this.logger.warn(
          `schedule recalc pulou loja inválida/inativa ${key} (${slug})`,
        );
        continue;
      }
      maps.set(
        key,
        await this.suggestions.priceMap(em, slug, key || null, [...eans]),
      );
    }
    return maps;
  }

  /**
   * Troca o congelado pela sugestão fresca do motor (preço E alvo — o motor
   * decide venda vs oferta, não o item agendado); descarta item sem sugestão.
   * Item com loja usa o mapa recalculado daquela loja e NÃO congela o caderno:
   * o alvo de oferta é o vencedor ATUAL da loja (um caderno congelado ficaria
   * obsoleto quando o vencedor muda — o revalidate rejeitaria o item).
   */
  private recalcItems(
    items: ScheduleItem[],
    suggestedByStore: Map<string, SuggestedPriceMap>,
  ): ApplyItemDto[] {
    return items.flatMap((i) => {
      const s = suggestedByStore.get(i.storeId ?? '')?.get(i.ean);
      return s === undefined
        ? []
        : [
            {
              ean: i.ean,
              target: s.target,
              price: s.price,
              cadernoId: i.storeId ? undefined : i.cadernoId,
              storeId: i.storeId,
            },
          ];
    });
  }
}
