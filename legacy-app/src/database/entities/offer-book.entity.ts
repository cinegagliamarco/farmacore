import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseProductTypeormEntity } from './base-product.entity';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';

@Entity('offer_book')
@Index('IDX_OFFER_BOOK_NAME', ['name'])
@Index('IDX_OFFER_BOOK_ACTIVE', ['active'])
@Index('IDX_OFFER_BOOK_EXTERNAL_ID', ['externalId'])
@Index('IDX_OFFER_BOOK_BASE_PRODUCT_ID', ['baseProductId'])
@Index('IDX_OFFER_BOOK_PRICE_FOR_OFFER', ['priceForOffer'])
export class OfferBookTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', name: 'base_product_id', nullable: false })
  public baseProductId: number;

  @Column({ type: 'text', nullable: false })
  public name: string;

  @Column({ type: 'boolean', default: true })
  public active: boolean;

  @Column({ type: 'bigint', name: 'external_id', nullable: false })
  public externalId: number;

  @Column({ type: 'timestamptz', name: 'expiration_date', nullable: true })
  public expirationDate: Date;

  @NumericColumn({ precision: 15, scale: 4, nullable: true, name: 'price_for_offer' })
  public priceForOffer?: number;

  @ManyToOne(() => BaseProductTypeormEntity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'base_product_id', referencedColumnName: 'id', foreignKeyConstraintName: 'fk_offer_book_base_product' })
  public baseProduct: BaseProductTypeormEntity;
}
