import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';
import { PriceRoundingDecimalRangeTypeormEntity } from './price-rounding-decimal-range.entity';

@Entity('price_rounding_rule')
export class PriceRoundingRuleTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @NumericColumn({ name: 'price_range_min', nullable: false })
  public priceRangeMin: number;

  @NumericColumn({ name: 'price_range_max', nullable: false })
  public priceRangeMax: number;

  @Column({ type: 'boolean', name: 'active', nullable: false, default: true })
  public active: boolean;

  @OneToMany(() => PriceRoundingDecimalRangeTypeormEntity, (dr) => dr.priceRoundingRule, { cascade: true })
  public decimalRanges: PriceRoundingDecimalRangeTypeormEntity[];
}
