import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleExecutionReportEntity } from './offer-book-rule-execution-report.entity';
import { OfferBookRuleProductEntity } from './offer-book-rule-product.entity';

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

  @OneToMany(() => OfferBookRuleProductEntity, (product) => product.rule)
  public products?: OfferBookRuleProductEntity[];

  @OneToMany(() => OfferBookRuleExecutionReportEntity, (report) => report.rule)
  public executionReports?: OfferBookRuleExecutionReportEntity[];
}
