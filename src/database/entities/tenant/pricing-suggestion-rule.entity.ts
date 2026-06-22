import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

export type SuggestionStrategy = 'margem' | 'concorrencia';
export type CompetitorMode = 'weighted' | 'cascade' | 'lowest';

export interface RuleCompetitor {
  competitor: CompetitorOrigin;
  /** weighted: peso % da média; cascade/lowest: ignorado (grava 1). */
  weight: number;
}

/**
 * Regra de sugestão de preços — por classificação (prefixo) OU por cluster de
 * produto. Estratégia `margem` (margem mínima) ou `concorrencia` (combina os
 * concorrentes por `competitorMode`). O cálculo roda no motor
 * (`pricing-suggestion.engine.ts`); aqui fica só a config. Mira classificação
 * XOR cluster (validado na borda — `clusterId` setado ⇒ `classifications` vazio).
 * Port do pricy-shelf `pricing_suggestion_rules`, menos `priceRoundingTypeId`
 * (o farmacore tem um único conjunto de arredondamento por tenant).
 */
@Entity({ name: 'pricing_suggestion_rule' })
@Index('IX_PRICING_SUGGESTION_RULE_ACTIVE', ['active'])
export class PricingSuggestionRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'jsonb', default: [] })
  public classifications!: string[];

  @Column({ name: 'cluster_id', type: 'uuid', nullable: true })
  public clusterId!: string | null;

  @Column({ name: 'exclude_cluster_ids', type: 'jsonb', default: [] })
  public excludeClusterIds!: string[];

  @Column({ type: 'text', default: 'margem' })
  public strategy!: SuggestionStrategy;

  @Column({ name: 'min_margin', type: 'numeric', precision: 6, scale: 2 })
  public minMargin!: string;

  @Column({ name: 'competitor_mode', type: 'text', default: 'weighted' })
  public competitorMode!: CompetitorMode;

  @Column({ type: 'jsonb', default: [] })
  public competitors!: RuleCompetitor[];

  @Column({
    name: 'variation_pct',
    type: 'numeric',
    precision: 6,
    scale: 2,
    default: 0,
  })
  public variationPct!: string;

  @Column({
    name: 'no_competitor_margin',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
  })
  public noCompetitorMargin!: string | null;

  @Column({ name: 'price_controlled', type: 'boolean', default: false })
  public priceControlled!: boolean;

  @Column({ name: 'ignore_pbm', type: 'boolean', default: false })
  public ignorePbm!: boolean;

  @Column({ name: 'apply_rounding', type: 'boolean', default: true })
  public applyRounding!: boolean;

  @Column({ type: 'boolean', default: true })
  public active!: boolean;
}
