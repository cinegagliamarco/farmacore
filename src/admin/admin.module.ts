import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { UserEntity } from '../database/entities/core/user.entity';
import { AuthModule } from '../auth/auth.module';
import { PipelineStepsModule } from '../pipeline/pipeline-steps.module';
import { TenantOnboardingService } from './services/tenant-onboarding.service';
import { TenantOffboardingService } from './services/tenant-offboarding.service';
import { CompetitorOriginAdminService } from './services/competitor-origin-admin.service';
import { DlqService } from './services/dlq.service';
import { TenantsController } from './controllers/tenants.controller';
import { IntegrationController } from './controllers/integration.controller';
import { IntegrationHealthController } from './controllers/integration-health.controller';
import { CompetitorOriginsController } from './controllers/competitor-origins.controller';
import { PipelineController } from './controllers/pipeline.controller';
import { DlqController } from './controllers/dlq.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TenantEntity, UserEntity]),
    AuthModule,
    PipelineStepsModule.forRoot({ withConsumers: false }),
  ],
  controllers: [
    TenantsController,
    IntegrationController,
    IntegrationHealthController,
    CompetitorOriginsController,
    PipelineController,
    DlqController,
  ],
  providers: [
    TenantOnboardingService,
    TenantOffboardingService,
    CompetitorOriginAdminService,
    DlqService,
  ],
})
export class AdminModule {}
