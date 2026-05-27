import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { CompetitorOrigin } from '../../enums/competitor-origin.enum';

@Entity({ schema: 'shared_catalog', name: 'product' })
@Index('IX_PRODUCT_EAN_ORIGIN', ['ean', 'origin'])
export class ProductEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', enum: CompetitorOrigin })
  public origin!: CompetitorOrigin;

  @Column({ type: 'text', nullable: true })
  public name?: string | null;

  @Column({ type: 'text', nullable: true })
  public url?: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  public price?: string | null;

  @Column({
    name: 'unit_sale_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public unitSalePrice?: string | null;

  @Column({ type: 'text', nullable: true })
  public supplier?: string | null;

  @Column({ type: 'text', nullable: true })
  public brand?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  public weight?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public height?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public length?: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  public width?: string | null;

  @Column({ type: 'jsonb', default: {} })
  public metadata!: Record<string, unknown>;
}
