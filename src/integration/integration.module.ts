import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { IntegrationConnectionService } from './integration-connection.service';
import { A7PharmaApiClient } from './a7-pharma-api.client';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationDatabaseConnectionEntity,
      TenantEntity,
    ]),
    HttpModule.register({ timeout: 30_000 }),
  ],
  providers: [
    CredentialEncryptionService,
    IntegrationDataSourceFactory,
    IntegrationConnectionService,
    A7PharmaApiClient,
  ],
  exports: [
    CredentialEncryptionService,
    IntegrationDataSourceFactory,
    IntegrationConnectionService,
    A7PharmaApiClient,
  ],
})
export class IntegrationModule {}
