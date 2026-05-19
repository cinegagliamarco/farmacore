import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { ProductTypeormEntity } from './product.entity';

@Entity('product_image')
export class ProductImageTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ name: 'product_id', type: 'int' })
  public productId: number;

  @Column({ name: 'url', type: 'text', nullable: false })
  public url: string;

  @ManyToOne(() => ProductTypeormEntity, (product) => product.images, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_product_image',
    referencedColumnName: 'id'
  })
  public product: ProductTypeormEntity;
}
