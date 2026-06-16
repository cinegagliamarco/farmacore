import { Module } from '@nestjs/common';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [ScrapersModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
