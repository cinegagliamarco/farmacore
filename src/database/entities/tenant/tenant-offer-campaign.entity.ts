import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Tenant-wide catalog of ERP promotional campaigns (caderno_oferta).
 * Populated by sync-offer-books-info; surfaced in the admin UI for
 * browsing/filtering. Distinct from offer_book_info — that one is
 * extension metadata on a per-EAN offer_book row.
 */
@Entity({ name: 'tenant_offer_campaign' })
@Index('UQ_TENANT_OFFER_CAMPAIGN_EXTERNAL_ID', ['externalId'], { unique: true })
@Index('IX_TENANT_OFFER_CAMPAIGN_ACTIVE_EXPIRATION', [
  'active',
  'expirationDate',
])
export class TenantOfferCampaignEntity extends BaseEntity {
  @Column({ name: 'external_id', type: 'bigint' })
  public externalId!: string;

  @Column({ type: 'text' })
  public name!: string;

  @Column({ type: 'boolean', default: false })
  public active!: boolean;

  @Column({ name: 'start_date', type: 'timestamptz', nullable: true })
  public startDate?: Date | null;

  @Column({ name: 'expiration_date', type: 'timestamptz', nullable: true })
  public expirationDate?: Date | null;
}
