import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ApplyTarget } from './pricing-apply-item.entity';

export type ScheduleStatus = 'pending' | 'fired' | 'cancelled' | 'failed';

export interface ScheduleItem {
  ean: string;
  target: ApplyTarget;
  price: number;
  cadernoId?: number;
  /** Loja alvo (uuid de core.tenant_store); ausente = aplicação global. */
  storeId?: string;
}

/**
 * Agendamento one-shot de aplicação de preço: dispara em `runAt` com os preços
 * congelados em `items`. Port do "agendado" do pricy-shelf, sem o ERP-scheduled
 * (roda no cron do farmacore — ver plano §17.2).
 */
@Entity({ name: 'pricing_schedule' })
@Index('IX_PRICING_SCHEDULE_STATUS_RUN_AT', ['status', 'runAt'])
export class PricingScheduleEntity extends BaseEntity {
  @Column({ name: 'run_at', type: 'timestamptz' })
  public runAt!: Date;

  @Column({ type: 'text', default: 'pending' })
  public status!: ScheduleStatus;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  public requestedBy!: string | null;

  @Column({ type: 'jsonb', default: [] })
  public items!: ScheduleItem[];

  @Column({ name: 'apply_run_id', type: 'uuid', nullable: true })
  public applyRunId!: string | null;

  @Column({ name: 'fired_at', type: 'timestamptz', nullable: true })
  public firedAt!: Date | null;

  // Recorrência: cron → re-arma para a próxima ocorrência ao disparar.
  @Column({ name: 'cron_expr', type: 'text', nullable: true })
  public cronExpr!: string | null;

  // Ao disparar, recalcula o preço pelo motor em vez de usar o congelado.
  @Column({ type: 'boolean', default: false })
  public recalc!: boolean;
}
