import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_rule_execution_report' })
@Index('IX_REPORT_RULE_STARTED', ['ruleId', 'startedAt'])
export class OfferBookRuleExecutionReportEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  public finishedAt?: Date | null;

  @Column({ type: 'text' })
  public status!: 'running' | 'completed' | 'failed';

  @Column({ type: 'text', nullable: true })
  public error?: string | null;
}
