import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_pricing_rule' })
export class OfferBookPricingRuleEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ type: 'text' })
  public expression!: string;

  @Column({ type: 'int', default: 100 })
  public priority!: number;
}
