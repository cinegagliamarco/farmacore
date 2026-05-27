import { EntityManager } from 'typeorm';
import { TenantOfferCampaignEntity } from '../../entities/tenant/tenant-offer-campaign.entity';

export interface TenantOfferCampaignUpsertInput {
  externalId: string;
  name: string;
  active: boolean;
  startDate?: Date | null;
  expirationDate?: Date | null;
}

/**
 * Tenant campaign catalog repository. Upsert by external_id so re-runs
 * refresh name/active/dates for each ERP campaign without leaving
 * duplicates. Stale rows (campaigns deleted from ERP) accumulate;
 * cleanup is a follow-up — same trade-off as offer_book.
 */
export class TenantOfferCampaignRepository {
  constructor(private readonly em: EntityManager) {}

  public async upsertManyByExternalId(
    inputs: TenantOfferCampaignUpsertInput[],
  ): Promise<void> {
    if (inputs.length === 0) return;
    await this.em
      .getRepository(TenantOfferCampaignEntity)
      .upsert(inputs, {
        conflictPaths: ['externalId'],
        skipUpdateIfNoValuesChanged: true,
      });
  }
}
