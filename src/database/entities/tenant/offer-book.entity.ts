import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book' })
@Index('UQ_OFFER_BOOK_EAN', ['ean'], { unique: true })
export class OfferBookEntity extends BaseEntity {
  @Column({ type: 'bigint' })
  public ean!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({
    name: 'target_price',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  public targetPrice?: string | null;

  /** A7Pharma caderno de ofertas id (idCadernoOferta) for write-back. */
  @Column({ name: 'external_id', type: 'bigint', nullable: true })
  public externalId?: string | null;
}
