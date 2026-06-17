import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Per-tenant price-rounding rule. Control-plane config, so it lives in
 * core keyed by tenant_id. Owns price_rounding_decimal_range rows.
 */
@Entity({ schema: 'core', name: 'price_rounding_rule' })
@Index('IX_PRICE_ROUNDING_RULE_TENANT', ['tenantId'])
export class PriceRoundingRuleEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;

  @Column({ type: 'int', default: 100 })
  public priority!: number;
}
