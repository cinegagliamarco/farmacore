import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { BaseProductTypeormEntity } from './base-product.entity';
import { SubsidiaryName } from '../../common/subsidiary-name.enum';

@Entity('base_product_stock')
@Index('IDX_BASE_PRODUCT_STOCK_BASE_PRODUCT_QUANTITY', ['baseProductId', 'quantity'])
export class BaseProductStockTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ name: 'base_product_id', type: 'int' })
  public baseProductId: number;

  @Column({ name: 'subsidiary_id', type: 'int' })
  public subsidiaryId: number;

  @Column({
    type: 'enum',
    enum: SubsidiaryName,
    enumName: 'subsidiary_name',
    name: 'subsidiary_name'
  })
  public subsidiaryName: SubsidiaryName;

  @Column({ type: 'int', default: 0, nullable: false })
  public quantity: number;

  @ManyToOne(() => BaseProductTypeormEntity, (baseProduct) => baseProduct.images, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'base_product_id',
    foreignKeyConstraintName: 'fk_base_product_stock',
    referencedColumnName: 'id'
  })
  public baseProduct: BaseProductTypeormEntity;
}
