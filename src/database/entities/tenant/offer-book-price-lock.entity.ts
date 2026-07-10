import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleEntity } from './offer-book-rule.entity';

/** Trava de margem mínima de uma offer_book_rule (por classificação). */
@Entity({ name: 'offer_book_price_lock' })
@Index('IX_OFFER_BOOK_PRICE_LOCK_RULE', ['ruleId'])
export class OfferBookPriceLockEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'jsonb', nullable: true })
  public classifications?: string[] | null;

  @Column({ name: 'min_margin', type: 'numeric', precision: 12, scale: 2 })
  public minMargin!: number;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @ManyToOne(() => OfferBookRuleEntity, (rule) => rule.priceLocks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'rule_id' })
  public rule?: OfferBookRuleEntity;
}
