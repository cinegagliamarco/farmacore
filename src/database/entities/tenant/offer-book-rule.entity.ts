import { Column, Entity } from 'typeorm';
import { CalculationBaseType } from '../../enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../enums/price-base-source.enum';
import { BaseEntity } from '../base.entity';

/**
 * A named pricing rule-set. Targets products either by EAN
 * (offer_book_rule_product rows) or by classification path
 * (target_classifications), never both. Carries the calculation base + the
 * competitor sources for COMPETITIVE_PRICE, and owns the pricing rules +
 * price locks that the engine applies. Standalone in the new app — unlike the
 * legacy schema it is not 1:1 with an offer_book_info.
 */
@Entity({ name: 'offer_book_rule' })
export class OfferBookRuleEntity extends BaseEntity {
  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'calculation_base_type', type: 'text' })
  public calculationBaseType!: CalculationBaseType;

  @Column({
    name: 'price_base_sources',
    type: 'text',
    array: true,
    nullable: true,
  })
  public priceBaseSources?: PriceBaseSource[] | null;

  @Column({
    name: 'target_classifications',
    type: 'text',
    array: true,
    nullable: true,
  })
  public targetClassifications?: string[] | null;

  @Column({ name: 'apply_price_rounding', type: 'boolean', default: false })
  public applyPriceRounding!: boolean;

  @Column({ type: 'boolean', default: true })
  public enabled!: boolean;
}
