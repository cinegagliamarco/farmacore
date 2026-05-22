import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule_execution_report_item' })
@Index('IX_REPORT_ITEM_REPORT', ['reportId'])
export class OfferBookRuleExecutionReportItemEntity extends BaseEntity {
  @Column({ name: 'report_id', type: 'uuid' })
  public reportId!: string;

  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ name: 'old_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public oldPrice?: string | null;

  @Column({ name: 'new_price', type: 'numeric', precision: 12, scale: 2, nullable: true })
  public newPrice?: string | null;

  @Column({ type: 'text', nullable: true })
  public outcome?: string | null;
}
