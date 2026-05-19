import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';
import { OfferBookRulesTypeormEntity } from './offer-book-rules.entity';

@Entity('offer_book_price_locks')
@Index('IDX_OFFER_BOOK_PRICE_LOCKS_RULES_ID', ['offerBookRulesId'])
@Index('IDX_OFFER_BOOK_PRICE_LOCKS_ACTIVE', ['active'])
export class OfferBookPriceLocksTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', name: 'offer_book_rules_id', nullable: false })
  public offerBookRulesId: number;

  @Column({ type: 'text', array: true, nullable: true })
  public classifications?: string[];

  @NumericColumn({ precision: 10, scale: 2, nullable: false, name: 'min_margin' })
  public minMargin: number;

  @Column({ type: 'boolean', default: true })
  public active: boolean;

  @ManyToOne(() => OfferBookRulesTypeormEntity, (rules) => rules.priceLocks, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_book_rules_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_price_locks_rules' })
  public offerBookRules: OfferBookRulesTypeormEntity;
}
