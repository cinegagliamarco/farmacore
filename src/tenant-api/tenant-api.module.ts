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
import { OfferBookRulesService } from './offer-book-rules/offer-book-rules.service';
import { OfferCampaignsController } from './offer-campaigns/offer-campaigns.controller';
import { OfferCampaignsService } from './offer-campaigns/offer-campaigns.service';
import { AuditController } from './pricing/audit.controller';
import { AuditService } from './pricing/audit.service';
import { CompetitorOriginsController } from './pricing/competitor-origins.controller';
import { CompetitorOriginsService } from './pricing/competitor-origins.service';
import { ClustersController } from './pricing/clusters.controller';
import { ClustersService } from './pricing/clusters.service';
import { PricingApplyController } from './pricing/pricing-apply.controller';
import { PricingApplyService } from './pricing/pricing-apply.service';
import { PricingRetentionCron } from './pricing/pricing-retention.cron';
import { PricingScheduleController } from './pricing/pricing-schedule.controller';
import { PricingScheduleService } from './pricing/pricing-schedule.service';
import { PricingScheduleCron } from './pricing/pricing-schedule.cron';
import { PricingSuggestionsController } from './pricing/pricing-suggestions.controller';
import { PricingSuggestionsService } from './pricing/pricing-suggestions.service';
import { SuggestionRulesController } from './pricing/suggestion-rules.controller';
import { SuggestionRulesService } from './pricing/suggestion-rules.service';

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
    SuggestionRulesController,
    ClustersController,
    PricingSuggestionsController,
    PricingApplyController,
    PricingScheduleController,
    AuditController,
    CompetitorOriginsController,
  ],
  providers: [
    CatalogService,
    CatalogMutationService,
    SettingsService,
    ClassificationsService,
    PriceRoundingService,
    OfferCampaignsService,
    OfferBookRulesService,
    SuggestionRulesService,
    ClustersService,
    PricingSuggestionsService,
    PricingApplyService,
    PricingScheduleService,
    PricingScheduleCron,
    PricingRetentionCron,
    AuditService,
    CompetitorOriginsService,
  ],
})
export class TenantApiModule {}
