import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantService } from '../../tenant/tenant.service';
import { TenantTransactionService } from '../../tenant/tenant-transaction.service';

const DEFAULT_TTL_DAYS = 90;

/**
 * Retenção dos runs de aplicação de preço: soft-delete (deleted_at) dos runs
 * já encerrados mais velhos que o TTL. Singleton na API (guarda WORKER_MODE),
 * diário. TTL configurável por `PRICING_RUN_TTL_DAYS` (default 90). Os itens
 * seguem o run pelo `deleted_at` na leitura — nada é apagado de fato.
 */
@Injectable()
export class PricingRetentionCron {
  private readonly logger = new Logger(PricingRetentionCron.name);

  constructor(
    private readonly tenants: TenantService,
    private readonly tx: TenantTransactionService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: 'UTC' })
  public async sweep(): Promise<void> {
    if (process.env.WORKER_MODE === '1') return;
    const ttlDays =
      Number(process.env.PRICING_RUN_TTL_DAYS) || DEFAULT_TTL_DAYS;
    const tenants = await this.tenants.listActive();
    for (const t of tenants) {
      if (t.slug === 'system') continue;
      try {
        await this.sweepTenant(t.schemaName, ttlDays);
      } catch (err) {
        this.logger.debug(
          `retention skipped for ${t.slug}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private async sweepTenant(
    schemaName: string,
    ttlDays: number,
  ): Promise<void> {
    await this.tx.runWithTenant(schemaName, async (em) => {
      // em.query de UPDATE..RETURNING devolve [rows, count]; conto pelas linhas.
      const result = await em.query<[{ id: string }[], number]>(
        `UPDATE pricing_apply_run
            SET deleted_at = now()
          WHERE deleted_at IS NULL
            AND status IN ('done', 'failed')
            AND created_at < now() - make_interval(days => $1)
          RETURNING id`,
        [ttlDays],
      );
      const deleted = result[0].length;
      if (deleted > 0) {
        this.logger.log(
          `retention soft-deleted ${deleted} runs in ${schemaName}`,
        );
      }
    });
  }
}
