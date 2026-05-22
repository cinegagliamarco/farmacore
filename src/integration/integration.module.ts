import { Global, Module } from '@nestjs/common';
import { IntegrationDataSourceFactory } from './integration-data-source.factory';

@Global()
@Module({
  providers: [IntegrationDataSourceFactory],
  exports: [IntegrationDataSourceFactory],
})
export class IntegrationModule {}
