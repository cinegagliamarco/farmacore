import { Column, Entity, Index, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BaseTypeormModel } from './base.typeorm-model';
import { OfferBookRulesTypeormEntity } from './offer-book-rules.entity';

@Entity('offer_book_info')
@Index('IDX_OFFER_BOOK_INFO_NAME', ['name'])
@Index('IDX_OFFER_BOOK_INFO_ACTIVE', ['active'])
@Index('IDX_OFFER_BOOK_INFO_EXTERNAL_ID', ['externalId'], { unique: true })
export class OfferBookInfoTypeormEntity extends BaseTypeormModel {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'text', nullable: false })
  public name: string;

  @Column({ type: 'bigint', name: 'external_id', nullable: false, unique: true })
  public externalId: number;

  @Column({ type: 'boolean', default: true })
  public active: boolean;

  @Column({ type: 'timestamptz', name: 'start_date', nullable: true })
  public startDate?: Date;

  @Column({ type: 'timestamptz', name: 'expiration_date', nullable: true })
  public expirationDate?: Date;

  @OneToOne(() => OfferBookRulesTypeormEntity, (rules) => rules.offerBookInfo, { cascade: true })
  public rules?: OfferBookRulesTypeormEntity;
}
