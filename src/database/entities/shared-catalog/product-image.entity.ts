import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'shared_catalog', name: 'product_image' })
@Index('IX_PRODUCT_IMAGE_PRODUCT', ['productId'])
export class ProductImageEntity extends BaseEntity {
  @Column({ name: 'product_id', type: 'uuid' })
  public productId!: string;

  @Column({ type: 'text' })
  public url!: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  public isPrimary!: boolean;
}
