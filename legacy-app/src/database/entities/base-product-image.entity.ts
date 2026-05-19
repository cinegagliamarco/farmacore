import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { BaseProductTypeormEntity } from './base-product.entity';

@Entity('base_product_image')
export class BaseProductImageTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ name: 'base_product_id', type: 'int' })
  public baseProductId: number;

  @Column({ name: 'url', type: 'text', nullable: false })
  public url: string;

  @ManyToOne(() => BaseProductTypeormEntity, (baseProduct) => baseProduct.images, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'base_product_id',
    foreignKeyConstraintName: 'fk_base_product_image',
    referencedColumnName: 'id'
  })
  public baseProduct: BaseProductTypeormEntity;
}
