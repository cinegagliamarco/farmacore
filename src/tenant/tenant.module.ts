import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../database/entities/core/tenant.entity';
import { TenantService } from './tenant.service';
import { TenantContext } from './tenant.context';
import { TenantTransactionService } from './tenant-transaction.service';
import { SearchPathInterceptor } from './interceptors/search-path.interceptor';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  providers: [
    TenantService,
    TenantContext,
    TenantTransactionService,
    { provide: APP_INTERCEPTOR, useClass: SearchPathInterceptor },
  ],
  exports: [TenantService, TenantContext, TenantTransactionService],
})
export class TenantModule {}
