import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * A minimum-margin floor for an offer_book_rule. When a matched product's
 * margin would fall below minMargin, the engine raises the price to hit it.
 */
@Entity({ name: 'offer_book_price_lock' })
@Index('IX_PRICE_LOCK_RULE', ['ruleId'])
export class OfferBookPriceLockEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'text', array: true, nullable: true })
  public classifications?: string[] | null;

  @Column({ name: 'min_margin', type: 'numeric', precision: 12, scale: 2 })
  public minMargin!: string;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;
}
