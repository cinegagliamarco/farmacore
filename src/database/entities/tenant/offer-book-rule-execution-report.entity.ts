import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { CalculationBaseType } from '../../enums/calculation-base-type.enum';
import { ExecutionOutcome } from '../../enums/execution-outcome.enum';
import { ExecutionType } from '../../enums/execution-type.enum';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleEntity } from './offer-book-rule.entity';
import { OfferBookRuleExecutionReportItemEntity } from './offer-book-rule-execution-report-item.entity';

/**
 * Auditoria de uma execução de regra. O ciclo de vida (RUNNING/…) mora na
 * regra (OfferBookRuleEntity.status); aqui só o resultado: contadores +
 * `outcome`. `idempotencyKey` dedupa por execução (unique quando presente).
 */
@Entity({ name: 'offer_book_rule_execution_report' })
@Index('IX_REPORT_RULE_EXECUTED', ['ruleId', 'executedAt'])
export class OfferBookRuleExecutionReportEntity extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'offer_book_info_id', type: 'bigint' })
  public offerBookInfoId!: string;

  @Column({ name: 'executed_at', type: 'timestamptz' })
  public executedAt!: Date;

  @Column({ name: 'execution_type', type: 'text' })
  public executionType!: ExecutionType;

  @Column({ name: 'calculation_base_type', type: 'text' })
  public calculationBaseType!: CalculationBaseType;

  @Column({ name: 'total_products', type: 'int', default: 0 })
  public totalProducts!: number;

  @Column({ name: 'products_updated', type: 'int', default: 0 })
  public productsUpdated!: number;

  @Column({ name: 'products_skipped', type: 'int', default: 0 })
  public productsSkipped!: number;

  /** Null enquanto o worker ainda não finalizou a execução. */
  @Column({ type: 'text', nullable: true })
  public outcome?: ExecutionOutcome | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  public errorMessage?: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  public idempotencyKey?: string | null;

  @ManyToOne(() => OfferBookRuleEntity, (rule) => rule.executionReports, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'rule_id' })
  public rule?: OfferBookRuleEntity;

  @OneToMany(
    () => OfferBookRuleExecutionReportItemEntity,
    (item) => item.report,
  )
  public items?: OfferBookRuleExecutionReportItemEntity[];
}
