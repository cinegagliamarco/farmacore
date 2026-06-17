import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Decimal range bucket for a price_rounding_rule. Moved to core with its
 * parent rule; rule_id FKs core.price_rounding_rule.
 */
@Entity({ schema: 'core', name: 'price_rounding_decimal_range' })
@Index('IX_DECIMAL_RANGE_RULE', ['ruleId'])
export class PriceRoundingDecimalRangeEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'rule_id', type: 'uuid' })
  public ruleId!: string;

  @Column({ name: 'min_decimal', type: 'numeric', precision: 5, scale: 2 })
  public minDecimal!: string;

  @Column({ name: 'max_decimal', type: 'numeric', precision: 5, scale: 2 })
  public maxDecimal!: string;

  @Column({ name: 'target_decimal', type: 'numeric', precision: 5, scale: 2 })
  public targetDecimal!: string;
}
