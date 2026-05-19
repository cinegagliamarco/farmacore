import { Column, Entity, Index, JoinColumn, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CalculationBaseType } from '../../common/calculation-base-type.enum';
import { DayOfWeek } from '../../common/day-of-week.enum';
import { OfferBookRulesStatus } from '../../common/offer-book-rules-status.enum';
import { PriceBaseSource } from '../../common/price-base-source.enum';
import { BaseTypeormModel } from './base.typeorm-model';
import { OfferBookInfoTypeormEntity } from './offer-book-info.entity';
import { OfferBookRulesProductsTypeormEntity } from './offer-book-rules-products.entity';
import { OfferBookPricingRulesTypeormEntity } from './offer-book-pricing-rules.entity';
import { OfferBookPriceLocksTypeormEntity } from './offer-book-price-locks.entity';

@Entity('offer_book_rules')
@Index('IDX_OFFER_BOOK_RULES_OFFER_BOOK_INFO_ID', ['offerBookInfoId'], { unique: true })
@Index('IDX_OFFER_BOOK_RULES_CALCULATION_BASE_TYPE', ['calculationBaseType'])
export class OfferBookRulesTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', name: 'offer_book_info_id', nullable: false, unique: true })
  public offerBookInfoId: number;

  @Column({
    type: 'enum',
    enum: CalculationBaseType,
    enumName: 'calculation_base_type_enum',
    nullable: false,
    name: 'calculation_base_type'
  })
  public calculationBaseType: CalculationBaseType;

  @Column({
    type: 'simple-array',
    name: 'price_base_sources',
    nullable: true
  })
  public priceBaseSources: PriceBaseSource[] | null;

  @Column({
    type: 'simple-array',
    name: 'grouped_classifications',
    nullable: true
  })
  public groupedClassifications: string[] | null;

  @Column({ type: 'boolean', name: 'schedule_enabled', nullable: false, default: false })
  public scheduleEnabled: boolean;

  @Column({
    type: 'simple-array',
    name: 'scheduled_days',
    nullable: true
  })
  public scheduledDays: DayOfWeek[] | null;

  @Column({ type: 'timestamp', name: 'last_scheduled_execution', nullable: true })
  public lastScheduledExecution: Date | null;

  @Column({ type: 'boolean', name: 'apply_price_rounding', nullable: false, default: false })
  public applyPriceRounding: boolean;

  @Column({
    type: 'enum',
    enum: OfferBookRulesStatus,
    enumName: 'offer_book_rules_status_enum',
    nullable: false,
    default: OfferBookRulesStatus.IDLE,
    name: 'status'
  })
  public status: OfferBookRulesStatus;

  @OneToOne(() => OfferBookInfoTypeormEntity, (info) => info.rules, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_book_info_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_rules_offer_book_info' })
  public offerBookInfo: OfferBookInfoTypeormEntity;

  @OneToMany(() => OfferBookRulesProductsTypeormEntity, (product) => product.offerBookRules, { cascade: true })
  public products: OfferBookRulesProductsTypeormEntity[];

  @OneToMany(() => OfferBookPricingRulesTypeormEntity, (pricingRule) => pricingRule.offerBookRules, { cascade: true })
  public pricingRules: OfferBookPricingRulesTypeormEntity[];

  @OneToMany(() => OfferBookPriceLocksTypeormEntity, (priceLock) => priceLock.offerBookRules, { cascade: true })
  public priceLocks: OfferBookPriceLocksTypeormEntity[];

  // Virtual property populated by loadRelationCountAndMap
  public productsCount?: number;
}
