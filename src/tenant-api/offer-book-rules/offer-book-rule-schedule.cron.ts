import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EntityManager } from 'typeorm';
import { ModuleCode } from '../../database/enums/module-code.enum';
import { ExecutionType } from '../../database/enums/execution-type.enum';
import { TenantService } from '../../tenant/tenant.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';
import { OfferBookRulesExecutionService } from './offer-book-rules-execution.service';

const TZ = 'America/Sao_Paulo';
/** Janela comercial local: não escreve preços no ERP de madrugada (como o legado). */
const WINDOW_START_HOUR = 7;
const WINDOW_END_HOUR = 21;

/**
 * Dispara a execução das regras agendadas (Fase 3 / PR B). Singleton na API
 * (guarda WORKER_MODE), de hora em hora dentro da janela comercial local. Cada
 * regra elegível é executada UMA vez por dia via o mesmo `execute(SCHEDULED)`
 * money-safe do POST manual — o dedup durável é um report SCHEDULED no dia civil
 * de America/Sao_Paulo; o claim RUNNING de `execute` serializa contra o manual e
 * entre réplicas. Conflito (já rodando / caderno inativo) só pula a regra.
 */
@Injectable()
export class OfferBookRuleScheduleCron {
  private readonly logger = new Logger(OfferBookRuleScheduleCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly tx: TenantTransactionService,
    private readonly execution: OfferBookRulesExecutionService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { timeZone: TZ })
  public async fire(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    if (!this.withinWindow()) return;

    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      if (
        t.slug === 'system' ||
        !t.modules.includes(ModuleCode.OFFER_BOOK_RULES)
      )
        continue;
      try {
        await this.fireForTenant(t.slug, t.schemaName);
      } catch (err) {
        // Tenant não migrado ou erro isolado não derruba os demais.
        this.logger.warn(
          `offer-book-rule schedule skipped for ${t.slug}: ${errMsg(err)}`,
        );
      }
    }
  }

  /** Público para testes determinísticos (a janela de hora mora só em `fire`). */
  public async fireForTenant(slug: string, schemaName: string): Promise<void> {
    const ruleIds = await this.tx.runWithTenant(schemaName, (em) =>
      this.dueRuleIds(em),
    );
    for (const ruleId of ruleIds) {
      try {
        // Uma transação POR regra: um conflito/falha isolado não reverte as
        // outras execuções agendadas do tenant.
        const { reportId } = await this.tx.runWithTenant(schemaName, (em) =>
          this.execution.execute(em, slug, ruleId, ExecutionType.SCHEDULED),
        );
        this.logger.log(
          `offer-book-rule ${ruleId} agendada para ${slug} → report ${reportId}`,
        );
      } catch (err) {
        // Já em execução (manual ou outra réplica) ou caderno inativo/vencido:
        // pula — tenta de novo no próximo dia elegível.
        this.logger.warn(
          `execução agendada pulada (regra ${ruleId}, ${slug}): ${errMsg(err)}`,
        );
      }
    }
  }

  /**
   * Regras elegíveis HOJE: habilitadas, não já em execução, cujo `scheduled_days`
   * (jsonb) contém o dia da semana local, e que ainda não geraram um report
   * SCHEDULED no dia civil local. Toda a resolução de fuso mora aqui, em SQL.
   */
  private async dueRuleIds(em: EntityManager): Promise<string[]> {
    const rows: Array<{ id: string }> = await em.query(
      `SELECT r.id
         FROM offer_book_rule r
        WHERE r.deleted_at IS NULL
          AND r.schedule_enabled = true
          AND r.status <> 'RUNNING'
          AND r.scheduled_days @> to_jsonb(
                extract(dow from now() AT TIME ZONE '${TZ}')::int)
          AND NOT EXISTS (
            SELECT 1 FROM offer_book_rule_execution_report x
             WHERE x.rule_id = r.id
               AND x.execution_type = 'SCHEDULED'
               AND (x.executed_at AT TIME ZONE '${TZ}')::date
                   = (now() AT TIME ZONE '${TZ}')::date
          )
        ORDER BY r.created_at`,
    );
    return rows.map((r) => r.id);
  }

  private withinWindow(): boolean {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: TZ,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date()),
    );
    return hour >= WINDOW_START_HOUR && hour <= WINDOW_END_HOUR;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
