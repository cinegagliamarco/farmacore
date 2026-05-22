import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule' })
export class OfferBookRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public conditions!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;
}
