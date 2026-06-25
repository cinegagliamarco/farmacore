import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** EAN targeted by an offer_book_rule (when it targets by product, not class). */
@Entity({ name: 'offer_book_rule_product' })
@Index('UQ_RULE_PRODUCT', ['ruleId', 'ean'], { unique: true })
export class OfferBookRuleProductEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;
}
