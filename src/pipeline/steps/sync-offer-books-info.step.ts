import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { A7PharmaRepositories } from '../../integration/repositories/a7pharma';
import {
  TenantOfferCampaignRepository,
  TenantOfferCampaignUpsertInput,
} from '../../database/repositories/tenant/tenant-offer-campaign.repository';

/**
 * Single-shot: read every caderno_oferta from the ERP and refresh the
 * tenant catalog. Volume is small (~100 rows/tenant), so no batching.
 */
@Injectable()
export class SyncOfferBooksInfoStep {
  private readonly logger = new Logger(SyncOfferBooksInfoStep.name);

  public async run(
    em: EntityManager,
    integrationDs: DataSource | null,
  ): Promise<void> {
    if (!integrationDs) {
      this.logger.warn(
        'Skipping sync-offer-books-info: integration DataSource not available',
      );
      return;
    }

    const a7 = new A7PharmaRepositories(integrationDs);
    const campaigns = await a7.cadernoOferta.findAll();
    if (campaigns.length === 0) return;

    const inputs: TenantOfferCampaignUpsertInput[] = campaigns.map((c) => ({
      externalId: String(c.id),
      name: c.nome,
      active: c.status === 'A',
      startDate: c.datahorainicial ?? null,
      expirationDate: c.datahorafinal ?? null,
    }));

    await new TenantOfferCampaignRepository(em).upsertManyByExternalId(inputs);
    this.logger.debug(`sync-offer-books-info: ${inputs.length} campaigns`);
  }
}
