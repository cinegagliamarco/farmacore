import path from 'node:path';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/app-config.service';
import { TenantEntity } from './entities/core/tenant.entity';
import { UserEntity } from './entities/core/user.entity';
import { RefreshTokenEntity } from './entities/core/refresh-token.entity';
import { PipelineRunEntity } from './entities/core/pipeline-run.entity';
import { PipelineOutboxEntity } from './entities/core/pipeline-outbox.entity';
import { IntegrationDatabaseConnectionEntity } from './entities/core/integration-database-connection.entity';

const CORE_ENTITIES = [
  TenantEntity,
  UserEntity,
  RefreshTokenEntity,
  PipelineRunEntity,
  PipelineOutboxEntity,
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
          config.nodeEnv === 'production'
            ? { rejectUnauthorized: false }
            : false,
        // search_path switches schema per tenant at query time, but TypeORM
        // still needs every entity's metadata registered on the connection —
        // core + shared_catalog + tenant. Same glob the migration data-source uses.
        entities: [path.join(__dirname, 'entities/**/*.entity.{ts,js}')],
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature(CORE_ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
