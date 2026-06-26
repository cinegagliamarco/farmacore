import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';
import { PriceRoundingRangeEntity } from './price-rounding-range.entity';

/**
 * Decimal bucket within a price band. When a price falls in the parent
 * range's [price_min, price_max] and its decimal part is in
 * [decimal_min, decimal_max], the price snaps to round_to. Mirrors
 * pricy-shelf's price_rounding_rules.
 */
@Entity({ schema: 'core', name: 'price_rounding_rule' })
@Index('IX_PRICE_ROUNDING_RULE_RANGE', ['rangeId'])
export class PriceRoundingRuleEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'range_id', type: 'uuid' })
  public rangeId!: string;

  @Column({ name: 'decimal_min', type: 'numeric', precision: 4, scale: 2 })
  public decimalMin!: string;

  @Column({ name: 'decimal_max', type: 'numeric', precision: 4, scale: 2 })
  public decimalMax!: string;

  @Column({ name: 'round_to', type: 'numeric', precision: 4, scale: 2 })
  public roundTo!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;

  @ManyToOne(() => PriceRoundingRangeEntity, (range) => range.rules, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'range_id' })
  public range?: PriceRoundingRangeEntity;
}
