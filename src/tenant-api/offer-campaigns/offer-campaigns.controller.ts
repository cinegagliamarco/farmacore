import { Controller, Get } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantEm } from '../../tenant/decorators/tenant-em.decorator';
import {
  OfferCampaign,
  OfferCampaignsService,
} from './offer-campaigns.service';

@Controller('offer-campaigns')
export class OfferCampaignsController {
  constructor(private readonly campaigns: OfferCampaignsService) {}

  @Get()
  public list(@TenantEm() em: EntityManager): Promise<OfferCampaign[]> {
    return this.campaigns.list(em);
  }
}
