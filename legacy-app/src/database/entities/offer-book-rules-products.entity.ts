import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { OfferBookRulesTypeormEntity } from './offer-book-rules.entity';
import { BaseProductTypeormEntity } from './base-product.entity';

@Entity('offer_book_rules_products')
@Index('IDX_OFFER_BOOK_RULES_PRODUCTS_RULES_ID', ['offerBookRulesId'])
@Index('IDX_OFFER_BOOK_RULES_PRODUCTS_BASE_PRODUCT_ID', ['baseProductId'])
@Unique('UQ_OFFER_BOOK_RULES_PRODUCTS', ['offerBookRulesId', 'baseProductId'])
export class OfferBookRulesProductsTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', name: 'offer_book_rules_id', nullable: false })
  public offerBookRulesId: number;

  @Column({ type: 'bigint', name: 'base_product_id', nullable: false })
  public baseProductId: number;

  @ManyToOne(() => OfferBookRulesTypeormEntity, (rules) => rules.products, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_book_rules_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_rules_products_rules' })
  public offerBookRules: OfferBookRulesTypeormEntity;

  @ManyToOne(() => BaseProductTypeormEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'base_product_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_rules_products_base_product' })
  public baseProduct: BaseProductTypeormEntity;
}
