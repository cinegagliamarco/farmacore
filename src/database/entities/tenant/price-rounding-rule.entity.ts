import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'price_rounding_rule' })
export class PriceRoundingRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;
}
