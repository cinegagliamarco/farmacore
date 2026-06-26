import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleEntity } from './offer-book-rule.entity';

@Entity({ name: 'offer_book_rule_product' })
@Index('UQ_RULE_PRODUCT', ['ruleId', 'ean'], { unique: true })
export class OfferBookRuleProductEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;

  @ManyToOne(() => OfferBookRuleEntity, (rule) => rule.products, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'rule_id' })
  public rule?: OfferBookRuleEntity;
}
