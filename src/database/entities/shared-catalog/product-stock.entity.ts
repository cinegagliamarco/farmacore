import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { ProductEntity } from './product.entity';

@Entity({ schema: 'shared_catalog', name: 'product_stock' })
@Index('IX_PRODUCT_STOCK_PRODUCT_CAPTURED', ['productId', 'capturedAt'])
export class ProductStockEntity extends BaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  public productId!: string;

  @Column({ type: 'int' })
  public quantity!: number;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  public capturedAt!: Date;

  @ManyToOne(() => ProductEntity, (product) => product.stocks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'product_id' })
  public product?: ProductEntity;
}
