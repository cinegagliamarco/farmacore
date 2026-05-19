import { Column, Entity, Index, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Origin } from '../../common/origin.enum';
import { BaseTypeormModel } from './base.typeorm-model';
import { NumericColumn } from './numeric.decorator';
import { ProductImageTypeormEntity } from './product-image.entity';
import { ProductStockTypeormEntity } from './product-stock.entity';

@Entity('product')
@Index('IDX_PRODUCT_EAN_ORIGIN', ['ean', 'origin'])
export class ProductTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({
    type: 'bigint',
    transformer: { to: (value: number) => value, from: (value: string) => Number(value) }
  })
  public ean: number;

  @Column({ type: 'text', nullable: true })
  public name: string;

  @Column({
    type: 'enum',
    enum: Origin,
    enumName: 'origin_enum'
  })
  public origin: Origin;

  @NumericColumn({ precision: 10, scale: 2, default: 0 })
  public price: number;

  @Column({ type: 'text', nullable: true })
  public observation?: string;

  @Column({ type: 'text', nullable: true })
  public brand?: string;

  @Column({ type: 'text', nullable: true })
  public image?: string;

  @OneToMany(() => ProductImageTypeormEntity, (image) => image.product, { cascade: true, eager: true })
  public images: ProductImageTypeormEntity[];

  @OneToOne(() => ProductStockTypeormEntity, (stock) => stock.product, { cascade: true, eager: true })
  public stock?: ProductStockTypeormEntity;

  @Column({ type: 'bigint', nullable: true, transformer: { to: (value: number) => value, from: (value: string) => Number(value) } })
  public sku?: number;

  @Column({ type: 'boolean', default: false, nullable: false, name: 'exists' })
  public exists: boolean;

  @Column({ type: 'text', nullable: true })
  public description?: string;

  @Column({ type: 'text', nullable: true })
  public category?: string;

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

  @Column({ type: 'text', nullable: true })
  public error?: string;

  @Column({ type: 'text', nullable: true })
  public supplier?: string;

  @Column({ type: 'boolean', default: false, nullable: false, name: 'is_pbm' })
  public isPbm: boolean;

  @Column({ type: 'text', nullable: true })
  public van?: string;
}
