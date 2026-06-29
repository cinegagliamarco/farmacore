import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../base.entity';
import { TenantEntity } from './tenant.entity';
import { PriceRoundingRuleEntity } from './price-rounding-rule.entity';

/**
 * Per-tenant price band for rounding. A band [price_min, price_max] owns
 * the decimal buckets (price_rounding_rule) that snap a price's decimal
 * part to round_to. Mirrors pricy-shelf's price_rounding_ranges.
 */
@Entity({ schema: 'core', name: 'price_rounding_range' })
@Index('IX_PRICE_ROUNDING_RANGE_TENANT', ['tenantId'])
export class PriceRoundingRangeEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'price_min', type: 'numeric', precision: 10, scale: 2 })
  public priceMin!: string;

  @Column({ name: 'price_max', type: 'numeric', precision: 10, scale: 2 })
  public priceMax!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant?: TenantEntity;

  @OneToMany(() => PriceRoundingRuleEntity, (rule) => rule.range)
  public rules?: PriceRoundingRuleEntity[];
}
