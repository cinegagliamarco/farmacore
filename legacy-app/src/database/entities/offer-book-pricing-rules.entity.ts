import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PricingActionType } from '../../common/pricing-action-type.enum';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';
import { OfferBookRulesTypeormEntity } from './offer-book-rules.entity';

@Entity('offer_book_pricing_rules')
@Index('IDX_OFFER_BOOK_PRICING_RULES_RULES_ID', ['offerBookRulesId'])
@Index('IDX_OFFER_BOOK_PRICING_RULES_ACTIVE', ['active'])
@Index('IDX_OFFER_BOOK_PRICING_RULES_ACTION_TYPE', ['actionType'])
export class OfferBookPricingRulesTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', name: 'offer_book_rules_id', nullable: false })
  public offerBookRulesId: number;

  @Column({ type: 'text', array: true, nullable: true })
  public classifications?: string[];

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'price_range_min' })
  public priceRangeMin?: number;

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'price_range_max' })
  public priceRangeMax?: number;

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'margin_range_min' })
  public marginRangeMin?: number;

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'margin_range_max' })
  public marginRangeMax?: number;

  @Column({
    type: 'enum',
    enum: PricingActionType,
    enumName: 'pricing_action_type_enum',
    nullable: false,
    name: 'action_type'
  })
  public actionType: PricingActionType;

  @NumericColumn({ precision: 10, scale: 2, nullable: false, name: 'percentage_value' })
  public percentageValue: number;

  @Column({ type: 'boolean', default: true })
  public active: boolean;

  @ManyToOne(() => OfferBookRulesTypeormEntity, (rules) => rules.pricingRules, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_book_rules_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_pricing_rules_rules' })
  public offerBookRules: OfferBookRulesTypeormEntity;
}
