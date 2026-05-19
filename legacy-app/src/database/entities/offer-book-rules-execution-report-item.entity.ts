import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PricingActionType } from '../../common/pricing-action-type.enum';
import { BaseTypeormModel } from './base.typeorm-model';
import { OfferBookRulesExecutionReportTypeormEntity } from './offer-book-rules-execution-report.entity';
import { NumericColumn } from './numeric.decorator';

@Entity('offer_book_rules_execution_report_item')
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_REPORT_ID', ['executionReportId'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_EAN', ['ean'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_ITEM_WAS_UPDATED', ['wasUpdated'])
export class OfferBookRulesExecutionReportItemTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer', name: 'execution_report_id', nullable: false })
  public executionReportId: number;

  @Column({ type: 'bigint', name: 'ean', nullable: false })
  public ean: number;

  @Column({ type: 'text', name: 'name', nullable: false })
  public name: string;

  @Column({ type: 'text', name: 'classification', nullable: false })
  public classification: string;

  @NumericColumn({ precision: 15, scale: 4, name: 'base_sale_price', nullable: false, default: 0 })
  public baseSalePrice: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'current_price', nullable: false, default: 0 })
  public currentPrice: number;

  @NumericColumn({ precision: 10, scale: 2, name: 'current_margin', nullable: false, default: 0 })
  public currentMargin: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'cost', nullable: false, default: 0 })
  public cost: number;

  @Column({
    type: 'enum',
    enum: PricingActionType,
    enumName: 'pricing_action_type_enum',
    nullable: true,
    name: 'action_type'
  })
  public actionType: PricingActionType | null;

  @NumericColumn({ precision: 10, scale: 2, name: 'percentage_value', nullable: false, default: 0 })
  public percentageValue: number;

  @NumericColumn({ precision: 10, scale: 2, name: 'applied_percentage_value', nullable: false, default: 0 })
  public appliedPercentageValue: number;

  @NumericColumn({ precision: 15, scale: 4, name: 'final_price', nullable: false, default: 0 })
  public finalPrice: number;

  @NumericColumn({ precision: 10, scale: 2, name: 'new_margin', nullable: false, default: 0 })
  public newMargin: number;

  @Column({ type: 'boolean', name: 'price_lock_applied', nullable: false, default: false })
  public priceLockApplied: boolean;

  @Column({ type: 'boolean', name: 'discount_skipped', nullable: false, default: false })
  public discountSkipped: boolean;

  @Column({ type: 'boolean', name: 'skipped_no_competitor_price', nullable: false, default: false })
  public skippedNoCompetitorPrice: boolean;

  @Column({ type: 'boolean', name: 'skipped_price_exceeds_limit', nullable: false, default: false })
  public skippedPriceExceedsLimit: boolean;

  @Column({ type: 'boolean', name: 'price_rounding_applied', nullable: false, default: false })
  public priceRoundingApplied: boolean;

  @Column({ type: 'boolean', name: 'was_updated', nullable: false, default: false })
  public wasUpdated: boolean;

  @ManyToOne(() => OfferBookRulesExecutionReportTypeormEntity, (report) => report.items, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'execution_report_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_offer_book_rules_execution_report_item_report'
  })
  public executionReport: OfferBookRulesExecutionReportTypeormEntity;
}
