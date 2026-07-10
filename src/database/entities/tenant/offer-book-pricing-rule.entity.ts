import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { PricingActionType } from '../../enums/pricing-action-type.enum';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleEntity } from './offer-book-rule.entity';

/** Regra de desconto/acréscimo de uma offer_book_rule (match por classificação + faixas). */
@Entity({ name: 'offer_book_pricing_rule' })
@Index('IX_OFFER_BOOK_PRICING_RULE_RULE', ['ruleId'])
export class OfferBookPricingRuleEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'jsonb', nullable: true })
  public classifications?: string[] | null;

  @Column({
    name: 'price_range_min',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceRangeMin?: number | null;

  @Column({
    name: 'price_range_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public priceRangeMax?: number | null;

  @Column({
    name: 'margin_range_min',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public marginRangeMin?: number | null;

  @Column({
    name: 'margin_range_max',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public marginRangeMax?: number | null;

  @Column({ name: 'action_type', type: 'text' })
  public actionType!: PricingActionType;

  @Column({
    name: 'percentage_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
  })
  public percentageValue!: number;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @ManyToOne(() => OfferBookRuleEntity, (rule) => rule.pricingRules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'rule_id' })
  public rule?: OfferBookRuleEntity;
}
