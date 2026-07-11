import { Column, Entity, Index, OneToMany } from 'typeorm';
import { CalculationBaseType } from '../../enums/calculation-base-type.enum';
import { DayOfWeek } from '../../enums/day-of-week.enum';
import { OfferBookRuleStatus } from '../../enums/offer-book-rule-status.enum';
import { PriceBaseSource } from '../../enums/price-base-source.enum';
import { BaseEntity } from '../base.entity';
import { OfferBookRuleExecutionReportEntity } from './offer-book-rule-execution-report.entity';
import { OfferBookPriceLockEntity } from './offer-book-price-lock.entity';
import { OfferBookPricingRuleEntity } from './offer-book-pricing-rule.entity';
import { OfferBookRuleProductEntity } from './offer-book-rule-product.entity';

/**
 * Conjunto de regras de precificação aplicado a um caderno de ofertas.
 * `offerBookInfoId` é o idCadernoOferta — o `external_id` que o
 * GET /offer-campaigns lista (tenant_offer_campaign.external_id). Não é FK
 * para a tabela `offer_book_info` (essa é metadata por-EAN); daí o unique
 * garantir uma única regra por caderno. Os produtos-alvo vêm por `products`
 * (EANs) OU por `classifications` (subárvore), nunca ambos.
 */
@Entity({ name: 'offer_book_rule' })
@Index('UQ_OFFER_BOOK_RULE_INFO', ['offerBookInfoId'], { unique: true })
export class OfferBookRuleEntity extends BaseEntity {
  @Column({ name: 'offer_book_info_id', type: 'bigint' })
  public offerBookInfoId!: string;

  @Column({ name: 'calculation_base_type', type: 'text' })
  public calculationBaseType!: CalculationBaseType;

  @Column({ name: 'price_base_sources', type: 'jsonb', nullable: true })
  public priceBaseSources?: PriceBaseSource[] | null;

  @Column({ type: 'jsonb', nullable: true })
  public classifications?: string[] | null;

  @Column({ name: 'schedule_enabled', type: 'boolean', default: false })
  public scheduleEnabled!: boolean;

  @Column({ name: 'scheduled_days', type: 'jsonb', nullable: true })
  public scheduledDays?: DayOfWeek[] | null;

  @Column({ name: 'apply_price_rounding', type: 'boolean', default: false })
  public applyPriceRounding!: boolean;

  /** Ciclo de vida da execução; RUNNING é o guard de concorrência do /execute. */
  @Column({ type: 'text', default: OfferBookRuleStatus.IDLE })
  public status!: OfferBookRuleStatus;

  /** Report que possui o lease da execução RUNNING; cerca finalizadores antigos. */
  @Column({ name: 'active_execution_report_id', type: 'uuid', nullable: true })
  public activeExecutionReportId?: string | null;

  @OneToMany(() => OfferBookRuleProductEntity, (product) => product.rule, {
    cascade: true,
  })
  public products?: OfferBookRuleProductEntity[];

  @OneToMany(() => OfferBookPricingRuleEntity, (rule) => rule.rule, {
    cascade: true,
  })
  public pricingRules?: OfferBookPricingRuleEntity[];

  @OneToMany(() => OfferBookPriceLockEntity, (lock) => lock.rule, {
    cascade: true,
  })
  public priceLocks?: OfferBookPriceLockEntity[];

  @OneToMany(() => OfferBookRuleExecutionReportEntity, (report) => report.rule)
  public executionReports?: OfferBookRuleExecutionReportEntity[];
}
