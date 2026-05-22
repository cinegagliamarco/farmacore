import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_info' })
@Index('UQ_OFFER_BOOK_INFO_BOOK', ['offerBookId'], { unique: true })
export class OfferBookInfoEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ type: 'jsonb', default: {} })
  public data!: Record<string, unknown>;
}
