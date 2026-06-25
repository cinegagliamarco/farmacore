import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { CatalogMutationService } from './catalog/catalog-mutation.service';
import { ClassificationsController } from './config/classifications.controller';
import { ClassificationsService } from './config/classifications.service';
import { PriceRoundingController } from './config/price-rounding.controller';
import { PriceRoundingService } from './config/price-rounding.service';
import { SettingsController } from './config/settings.controller';
import { SettingsService } from './config/settings.service';
import { OfferBookRulesController } from './offer-book-rules/offer-book-rules.controller';
import { OfferBookRulesExecutionService } from './offer-book-rules/offer-book-rules-execution.service';
import { OfferBookRulesManagementService } from './offer-book-rules/offer-book-rules-management.service';
import { OfferBookRulesService } from './offer-book-rules/offer-book-rules.service';
import { OfferCampaignsController } from './offer-campaigns/offer-campaigns.controller';
import { OfferCampaignsService } from './offer-campaigns/offer-campaigns.service';

/**
 * Tenant-user-facing API (the FE's surface). Every route is tenant-scoped
 * by the global SearchPathInterceptor + JwtAuthGuard — no admin guard.
 * System operations live under /admin instead.
 */
@Module({
  controllers: [
    CatalogController,
    SettingsController,
    ClassificationsController,
    PriceRoundingController,
    OfferCampaignsController,
    OfferBookRulesController,
  ],
  providers: [
    CatalogService,
    CatalogMutationService,
    SettingsService,
    ClassificationsService,
    PriceRoundingService,
    OfferCampaignsService,
    OfferBookRulesService,
    OfferBookRulesManagementService,
    OfferBookRulesExecutionService,
  ],
})
export class TenantApiModule {}
