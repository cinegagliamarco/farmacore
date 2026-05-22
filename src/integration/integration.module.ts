import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationDatabaseConnectionEntity } from '../database/entities/core/integration-database-connection.entity';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { CredentialEncryptionService } from './credential-encryption.service';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';
import { IntegrationConnectionService } from './integration-connection.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationDatabaseConnectionEntity,
      TenantEntity,
    ]),
  ],
  providers: [
    CredentialEncryptionService,
    IntegrationDataSourceFactory,
    IntegrationConnectionService,
  ],
  exports: [
    CredentialEncryptionService,
    IntegrationDataSourceFactory,
    IntegrationConnectionService,
  ],
})
export class IntegrationModule {}
