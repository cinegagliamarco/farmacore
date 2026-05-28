import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PresentationModule } from './presentation';
import { DatabaseModule } from './database/database.module';
import { TenantModule } from './tenant/tenant.module';
import { IntegrationModule } from './integration/integration.module';
import { QueueModule } from './queue/queue.module';
import { PipelineStepsModule } from './pipeline/pipeline-steps.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    AppConfigModule,
    PresentationModule,
    DatabaseModule,
    TenantModule,
    IntegrationModule,
    QueueModule,
    PipelineStepsModule.forRoot({ withConsumers: true }),
    ObservabilityModule,
  ],
})
export class WorkerModule {}
