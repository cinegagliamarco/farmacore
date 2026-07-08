import { Module } from '@nestjs/common';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { StorageModule } from '../storage/storage.module';
import { BaseProductsAdminController } from './base-products-admin.controller';
import { BaseProductsAdminService } from './base-products-admin.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [ScrapersModule, StorageModule],
  controllers: [ProductsController, BaseProductsAdminController],
  providers: [ProductsService, BaseProductsAdminService],
})
export class ProductsModule {}
