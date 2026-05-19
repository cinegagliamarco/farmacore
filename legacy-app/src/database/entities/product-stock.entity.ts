import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { ProductTypeormEntity } from './product.entity';

@Entity('product_stock')
export class ProductStockTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ name: 'product_id', type: 'int', unique: true })
  public productId: number;

  @Column({ type: 'int', default: 0, nullable: false, name: 'subsidiary_one_stock' })
  public subsidiaryOneStock: number;

  @Column({ type: 'int', default: 0, nullable: false, name: 'subsidiary_two_stock' })
  public subsidiaryTwoStock: number;

  @Column({ type: 'boolean', default: false, nullable: false, name: 'has_stock' })
  public hasStock: boolean;

  @Column({ type: 'text', nullable: true })
  public error?: string;

  @OneToOne(() => ProductTypeormEntity, (product) => product.stock, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'fk_product_stock',
    referencedColumnName: 'id'
  })
  public product: ProductTypeormEntity;
}

