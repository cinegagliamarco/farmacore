import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { PricingApplyRunEntity } from './pricing-apply-run.entity';

export type ApplyItemStatus = 'pending' | 'applied' | 'skipped' | 'failed';
export type ApplyTarget = 'precoVenda' | 'precoOferta';

/**
 * Item de um run de apply: o EAN, o alvo (venda/oferta), o preço APROVADO
 * (congelado) e o snapshot do preço anterior (auditoria/undo). `batch_seq` é
 * atribuído pelo dispatch; o batch consumer processa por (run, batch_seq).
 */
@Entity({ name: 'pricing_apply_item' })
@Index('IX_PRICING_APPLY_ITEM_RUN_BATCH', ['applyRunId', 'batchSeq'])
@Index('IX_PRICING_APPLY_ITEM_RUN_STATUS', ['applyRunId', 'status'])
export class PricingApplyItemEntity extends BaseEntity {
  @Column({ name: 'apply_run_id', type: 'uuid' })
  public applyRunId!: string;

  @Column({ name: 'batch_seq', type: 'int', nullable: true })
  public batchSeq!: number | null;

  @Column({ type: 'text' })
  public ean!: string;

  @Column({ type: 'text' })
  public target!: ApplyTarget;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  public price!: string;

  @Column({ name: 'caderno_id', type: 'bigint', nullable: true })
  public cadernoId!: string | null;

  @Column({
    name: 'price_old_sell',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceOldSell!: string | null;

  @Column({
    name: 'price_old_offer',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceOldOffer!: string | null;

  @Column({ type: 'text', nullable: true })
  public basis!: string | null;

  @Column({ name: 'rule_id', type: 'uuid', nullable: true })
  public ruleId!: string | null;

  @Column({
    name: 'cost_at_apply',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  public costAtApply!: string | null;

  @Column({ type: 'text', default: 'pending' })
  public status!: ApplyItemStatus;

  @Column({ type: 'text', nullable: true })
  public reason!: string | null;

  @Column({ name: 'erp_result', type: 'text', nullable: true })
  public erpResult!: string | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  public appliedAt!: Date | null;

  @ManyToOne(() => PricingApplyRunEntity, (run) => run.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'apply_run_id' })
  public applyRun?: PricingApplyRunEntity;
}
