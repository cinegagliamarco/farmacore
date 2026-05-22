import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ schema: 'shared_catalog', name: 'base_product' })
@Index('UQ_BASE_PRODUCT_EAN', ['ean'], { unique: true })
export class BaseProductEntity extends BaseEntity {
  @Column({ type: 'bigint', unique: true })
  public ean!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'active_ingredient', type: 'text', nullable: true })
  public activeIngredient?: string | null;

  @Column({ type: 'boolean', default: false })
  public generic!: boolean;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public height?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public length?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public width?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  public weight?: string | null;
}
