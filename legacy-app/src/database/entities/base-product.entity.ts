import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BaseProductOrigin } from '../../common/base-product-origin.enum';
import { ActiveIngredientTypeormEntity } from './active-ingredient.entity';
import { BaseProductImageTypeormEntity } from './base-product-image.entity';
import { BaseProductStockTypeormEntity } from './base-product-stock.entity';
import { BaseTypeormModel } from './base.typeorm-model';
import { ClassificationTypeormEntity } from './classification.entity';
import { NumericColumn } from './numeric.decorator';
import { OfferBookTypeormEntity } from './offer-book.entity';

export interface Deal {
  totalPrice: number;
  discount: number;
  itemCadernoOfertaId: number;
}

export type Deals = Record<number, Deal>;

@Entity('base_product')
@Index('IDX_BASE_PRODUCT_NAME', ['name'])
@Index('IDX_BASE_PRODUCT_EAN', ['ean'])
@Index('IDX_BASE_PRODUCT_CLASSIFICATION_ID', ['classificationId'])
@Index('IDX_BASE_PRODUCT_STATUS', ['status'])
@Index('IDX_BASE_PRODUCT_ORIGIN', ['origin'])
export class BaseProductTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'bigint', unique: true, nullable: true, name: 'external_id' })
  public externalId?: number;

  @Column({ type: 'boolean', default: false, nullable: false })
  public monitored: boolean;

  @Column({ type: 'bigint', unique: true, nullable: false })
  public ean: number;

  @Column({ type: 'boolean', default: true, nullable: false })
  public active: boolean;

  @Column({ type: 'text', nullable: true })
  public name?: string;

  @NumericColumn({ precision: 10, scale: 2, nullable: true })
  public price?: number;

  @Column({ type: 'text', nullable: true })
  public book?: string;

  @Column({ type: 'text', nullable: true })
  public curve?: string;

  @Column({ type: 'boolean', default: false })
  public generic: boolean;

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'average_unit_cost' })
  public averageUnitCost?: number;

  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'unit_sale_price' })
  public unitSalePrice?: number;

  @Column({ type: 'text', nullable: true })
  public description?: string;

  // Synchronized from integration database (embalagem -> produto -> fabricante -> pessoa.nome)
  @Column({ type: 'text', nullable: true })
  public supplier?: string;

  // Foreign key to classification table
  @Column({ type: 'integer', nullable: true, name: 'classification_id' })
  public classificationId?: number;

  // Synchronized from integration database (classificacaoproduto -> classificacao.caminho where principal = true)
  @ManyToOne(() => ClassificationTypeormEntity, (classification) => classification.baseProducts, { nullable: true })
  @JoinColumn({
    name: 'classification_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_base_product_classification'
  })
  public classificationEntity?: ClassificationTypeormEntity;

  // Synchronized from integration database (custoproduto.customedio - highest value)
  @NumericColumn({ precision: 15, scale: 4, nullable: true })
  public cost?: number;

  // Calculated field: (price - cost) / price * 100
  @NumericColumn({ precision: 10, scale: 2, nullable: true })
  public margin?: number;

  // Calculated field: (price - averageCompetitorPrice) / averageCompetitorPrice * 100
  @NumericColumn({ precision: 10, scale: 2, nullable: true, name: 'average_variation' })
  public averageVariation?: number;

  // Calculated field based on averageVariation: 'OK', 'ATENÇÃO', 'SUSPEITA'
  @Column({ type: 'text', nullable: true })
  public status?: string;

  @OneToMany(() => BaseProductImageTypeormEntity, (baseProductImage) => baseProductImage.baseProduct, { eager: true, cascade: true })
  public images: BaseProductImageTypeormEntity[];

  @Column({ type: 'boolean', default: false, nullable: false, name: 'skip_image_generation' })
  public skipImageGeneration: boolean;

  @Column({ type: 'jsonb', nullable: true })
  public deals?: Deals;

  @Column({
    type: 'enum',
    enum: BaseProductOrigin,
    enumName: 'base_product_origin_enum',
    nullable: false,
    default: BaseProductOrigin.ERP
  })
  public origin: BaseProductOrigin;

  @OneToMany(() => OfferBookTypeormEntity, (offerBook) => offerBook.baseProduct, { eager: true, cascade: true })
  public offerBooks: OfferBookTypeormEntity[];

  @OneToMany(() => BaseProductStockTypeormEntity, (stock) => stock.baseProduct)
  public stocks: BaseProductStockTypeormEntity[];

  @NumericColumn({ precision: 10, scale: 2, nullable: false, default: 0 })
  public mat: number;

  // Synchronized from integration database (embalagem -> produto -> principioativo.nome)
  @Column({ type: 'text', nullable: true, name: 'active_ingredient' })
  public activeIngredient?: string;

  @ManyToOne(() => ActiveIngredientTypeormEntity, (activeIngredient) => activeIngredient.baseProducts, { nullable: true })
  @JoinColumn({
    name: 'active_ingredient',
    referencedColumnName: 'name',
    foreignKeyConstraintName: 'fk_base_product_active_ingredient'
  })
  public activeIngredientEntity?: ActiveIngredientTypeormEntity;

  @NumericColumn({ precision: 10, scale: 3, nullable: true })
  public weight?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true, name: 'cubic_weight' })
  public cubicWeight?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public height?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public length?: number;

  @NumericColumn({ precision: 10, scale: 4, nullable: true })
  public width?: number;

  // Date of the last receipt in DD-MM-YYYY format
  @Column({ type: 'text', nullable: true, name: 'receipt_date' })
  public receiptDate?: string;
}
