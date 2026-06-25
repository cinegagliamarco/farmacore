import { Column, Entity, Index } from 'typeorm';
import { CalculationBaseType } from '../../enums/calculation-base-type.enum';
import { BaseEntity } from '../base.entity';

export type ExecutionType = 'MANUAL' | 'SCHEDULED';
export type ExecutionOutcome =
  | 'SUCCESS'
  | 'PARTIALLY_SUCCEEDED'
  | 'FAILURE'
  | 'NO_CHANGES';

/** Audit header for one execution of an offer_book_rule (one per run). */
@Entity({ name: 'offer_book_rule_execution_report' })
@Index('IX_REPORT_RULE_STARTED', ['ruleId', 'startedAt'])
export class OfferBookRuleExecutionReportEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'execution_type', type: 'text' })
  public executionType!: ExecutionType;

  @Column({ name: 'calculation_base_type', type: 'text' })
  public calculationBaseType!: CalculationBaseType;

  @Column({ name: 'started_at', type: 'timestamptz' })
  public startedAt!: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  public finishedAt?: Date | null;

  @Column({ name: 'total_products', type: 'int', default: 0 })
  public totalProducts!: number;

  @Column({ name: 'products_updated', type: 'int', default: 0 })
  public productsUpdated!: number;

  @Column({ name: 'products_skipped', type: 'int', default: 0 })
  public productsSkipped!: number;

  @Column({ type: 'text', nullable: true })
  public outcome?: ExecutionOutcome | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage?: string | null;
}
