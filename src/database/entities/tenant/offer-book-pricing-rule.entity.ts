import { Column, Entity, Index } from 'typeorm';
import { PricingActionType } from '../../enums/pricing-action-type.enum';
import { BaseEntity } from '../base.entity';

/**
 * One pricing rule of an offer_book_rule. Matches products by classification
 * (2-level prefix) and/or price/margin range, then applies a discount or
 * increase. No filters = applies to every product in the rule's target.
 */
@Entity({ name: 'offer_book_pricing_rule' })
@Index('IX_PRICING_RULE_RULE', ['ruleId'])
export class OfferBookPricingRuleEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'text', array: true, nullable: true })
  public classifications?: string[] | null;

  @Column({
    name: 'price_range_min',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceRangeMin?: string | null;

  @Column({
    name: 'price_range_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceRangeMax?: string | null;

  @Column({
    name: 'margin_range_min',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public marginRangeMin?: string | null;

  @Column({
    name: 'margin_range_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public marginRangeMax?: string | null;

  @Column({ name: 'action_type', type: 'text' })
  public actionType!: PricingActionType;

  @Column({
    name: 'percentage_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  public percentageValue!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;
}
