import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { TenantEntity } from './entities/core/tenant.entity';
import { UserEntity } from './entities/core/user.entity';
import { RefreshTokenEntity } from './entities/core/refresh-token.entity';
import { PipelineRunEntity } from './entities/core/pipeline-run.entity';
import { IntegrationDatabaseConnectionEntity } from './entities/core/integration-database-connection.entity';

const CORE_ENTITIES = [
  TenantEntity,
  UserEntity,
  RefreshTokenEntity,
  PipelineRunEntity,
  IntegrationDatabaseConnectionEntity,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: 'postgres',
        url: config.databaseUrl,
        ssl:
          config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
        entities: CORE_ENTITIES,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(CORE_ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
