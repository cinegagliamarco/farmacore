import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../base.entity';
import { OfferBookEntity } from './offer-book.entity';

@Entity({ name: 'offer_book_info' })
@Index('UQ_OFFER_BOOK_INFO_BOOK', ['offerBookId'], { unique: true })
export class OfferBookInfoEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ type: 'jsonb', default: {} })
  public data!: Record<string, unknown>;

  @ManyToOne(() => OfferBookEntity, (book) => book.infos, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'offer_book_id' })
  public offerBook?: OfferBookEntity;
}
