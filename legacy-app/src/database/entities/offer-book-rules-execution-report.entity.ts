import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CalculationBaseType } from '../../common/calculation-base-type.enum';
import { ExecutionType } from '../../common/execution-type.enum';
import { ExecutionOutcome } from '../../common/execution-outcome.enum';
import { BaseTypeormModel } from './base.typeorm-model';
import { OfferBookRulesTypeormEntity } from './offer-book-rules.entity';
import { OfferBookRulesExecutionReportItemTypeormEntity } from './offer-book-rules-execution-report-item.entity';

@Entity('offer_book_rules_execution_report')
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_RULES_ID', ['offerBookRulesId'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTED_AT', ['executedAt'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_EXECUTION_TYPE', ['executionType'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OFFER_BOOK_INFO_ID', ['offerBookInfoId'])
@Index('IDX_OFFER_BOOK_RULES_EXECUTION_REPORT_OUTCOME', ['outcome'])
export class OfferBookRulesExecutionReportTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer', name: 'offer_book_rules_id', nullable: false })
  public offerBookRulesId: number;

  @Column({ type: 'bigint', name: 'offer_book_info_id', nullable: false })
  public offerBookInfoId: number;

  @Column({ type: 'timestamp', name: 'executed_at', nullable: false })
  public executedAt: Date;

  @Column({
    type: 'enum',
    enum: ExecutionType,
    enumName: 'execution_type_enum',
    nullable: false,
    name: 'execution_type'
  })
  public executionType: ExecutionType;

  @Column({
    type: 'enum',
    enum: CalculationBaseType,
    enumName: 'calculation_base_type_enum',
    nullable: false,
    name: 'calculation_base_type'
  })
  public calculationBaseType: CalculationBaseType;

  @Column({ type: 'integer', name: 'total_products', nullable: false, default: 0 })
  public totalProducts: number;

  @Column({ type: 'integer', name: 'products_updated', nullable: false, default: 0 })
  public productsUpdated: number;

  @Column({ type: 'integer', name: 'products_skipped', nullable: false, default: 0 })
  public productsSkipped: number;

  @Column({
    type: 'enum',
    enum: ExecutionOutcome,
    enumName: 'execution_outcome_enum',
    nullable: false,
    name: 'outcome',
    default: ExecutionOutcome.SUCCESS
  })
  public outcome: ExecutionOutcome;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  public errorMessage: string | null;

  @ManyToOne(() => OfferBookRulesTypeormEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_book_rules_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_rules_execution_report_rules' })
  public offerBookRules: OfferBookRulesTypeormEntity;

  @OneToMany(() => OfferBookRulesExecutionReportItemTypeormEntity, (item) => item.executionReport, { cascade: true })
  public items: OfferBookRulesExecutionReportItemTypeormEntity[];
}
