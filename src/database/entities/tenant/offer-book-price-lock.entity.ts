import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

@Entity({ name: 'offer_book_price_lock' })
@Index('UQ_PRICE_LOCK_BOOK', ['offerBookId'], { unique: true })
export class OfferBookPriceLockEntity extends BaseEntity {
  @Column({ name: 'offer_book_id', type: 'uuid' })
  public offerBookId!: string;

  @Column({ name: 'locked_price', type: 'numeric', precision: 12, scale: 2 })
  public lockedPrice!: string;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  public lockedUntil?: Date | null;
}
