import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PresentationModule } from './presentation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { TenantModule } from './tenant/tenant.module';
import { IntegrationModule } from './integration/integration.module';
import { QueueModule } from './queue/queue.module';
import { PipelineStepsModule } from './pipeline/pipeline-steps.module';

@Module({
  imports: [
    AppConfigModule,
    PresentationModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    TenantModule,
    IntegrationModule,
    QueueModule,
    PipelineStepsModule.forRoot({ withConsumers: false }),
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: (): ValidationPipe =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
    },
  ],
})
export class AppModule {}
