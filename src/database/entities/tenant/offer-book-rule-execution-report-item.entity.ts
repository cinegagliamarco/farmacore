import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PricingActionType } from '../../enums/pricing-action-type.enum';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleExecutionReportEntity } from './offer-book-rule-execution-report.entity';

/** Ledger money-safe: dirige o push à A7 e dedupa a redelivery. */
export type ItemApplyStatus = 'pending' | 'applied' | 'failed' | 'skipped';

/** Snapshot por produto de uma execução (um por produto atualizado OU pulado). */
@Entity({ name: 'offer_book_rule_execution_report_item' })
@Index('IX_REPORT_ITEM_REPORT_STATUS', ['reportId', 'applyStatus'])
export class OfferBookRuleExecutionReportItemEntity extends BaseEntity {
  @Column({ name: 'report_id', type: 'uuid' })
  public reportId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text' })
  public classification!: string;

  @Column({
    name: 'base_sale_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  public baseSalePrice!: number;

  @Column({
    name: 'current_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  public currentPrice!: number;

  @Column({
    name: 'current_margin',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  public currentMargin!: number;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  public cost!: number;

  @Column({ name: 'action_type', type: 'text', nullable: true })
  public actionType?: PricingActionType | null;

  @Column({
    name: 'percentage_value',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  public percentageValue!: number;

  @Column({
    name: 'applied_percentage_value',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  public appliedPercentageValue!: number;

  @Column({
    name: 'final_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  public finalPrice!: number;

  @Column({
    name: 'new_margin',
    type: 'numeric',
    precision: 10,
    scale: 2,
    default: 0,
  })
  public newMargin!: number;

  @Column({ name: 'price_lock_applied', type: 'boolean', default: false })
  public priceLockApplied!: boolean;

  @Column({ name: 'discount_skipped', type: 'boolean', default: false })
  public discountSkipped!: boolean;

  @Column({
    name: 'skipped_no_competitor_price',
    type: 'boolean',
    default: false,
  })
  public skippedNoCompetitorPrice!: boolean;

  @Column({
    name: 'skipped_price_exceeds_limit',
    type: 'boolean',
    default: false,
  })
  public skippedPriceExceedsLimit!: boolean;

  @Column({ name: 'price_rounding_applied', type: 'boolean', default: false })
  public priceRoundingApplied!: boolean;

  @Column({ name: 'was_updated', type: 'boolean', default: false })
  public wasUpdated!: boolean;

  @Column({ name: 'apply_status', type: 'text', default: 'pending' })
  public applyStatus!: ItemApplyStatus;

  @Column({ name: 'apply_error', type: 'text', nullable: true })
  public applyError?: string | null;

  @ManyToOne(
    () => OfferBookRuleExecutionReportEntity,
    (report) => report.items,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'report_id' })
  public report?: OfferBookRuleExecutionReportEntity;
}
