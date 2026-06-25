import { Column, Entity, Index } from 'typeorm';
import { PricingActionType } from '../../enums/pricing-action-type.enum';
import { BaseEntity } from '../base.entity';

/**
 * Per-product audit row of an execution report — the full preview snapshot
 * plus `wasUpdated` (true only when the price was pushed to the ERP).
 */
@Entity({ name: 'offer_book_rule_execution_report_item' })
@Index('IX_REPORT_ITEM_REPORT', ['reportId'])
export class OfferBookRuleExecutionReportItemEntity extends BaseEntity {
  @Column({ name: 'report_id', type: 'uuid' })
  public reportId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', nullable: true })
  public name?: string | null;

  @Column({ type: 'text', nullable: true })
  public classification?: string | null;

  @Column({
    name: 'base_sale_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public baseSalePrice?: string | null;

  @Column({
    name: 'current_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public currentPrice?: string | null;

  @Column({
    name: 'current_margin',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public currentMargin?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  public cost?: string | null;

  @Column({ name: 'action_type', type: 'text', nullable: true })
  public actionType?: PricingActionType | null;

  @Column({
    name: 'percentage_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public percentageValue?: string | null;

  @Column({
    name: 'applied_percentage_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public appliedPercentageValue?: string | null;

  @Column({
    name: 'final_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public finalPrice?: string | null;

  @Column({
    name: 'new_margin',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public newMargin?: string | null;

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
}
