import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';
import { PriceRoundingRuleTypeormEntity } from './price-rounding-rule.entity';

@Entity('price_rounding_decimal_range')
export class PriceRoundingDecimalRangeTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'int', name: 'price_rounding_rule_id', nullable: false })
  public priceRoundingRuleId: number;

  @NumericColumn({ name: 'decimal_range_from', nullable: false })
  public decimalRangeFrom: number;

  @NumericColumn({ name: 'decimal_range_to', nullable: false })
  public decimalRangeTo: number;

  @NumericColumn({ name: 'round_to', nullable: false })
  public roundTo: number;

  @ManyToOne(() => PriceRoundingRuleTypeormEntity, (rule) => rule.decimalRanges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'price_rounding_rule_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_price_rounding_decimal_range_rule' })
  public priceRoundingRule: PriceRoundingRuleTypeormEntity;
}
