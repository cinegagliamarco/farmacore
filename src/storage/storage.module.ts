import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CompetitorImageService } from './competitor-image.service';
import { R2StorageService } from './r2-storage.service';

@Module({
  imports: [HttpModule.register({ timeout: 30_000, maxRedirects: 5 })],
  providers: [R2StorageService, CompetitorImageService],
  exports: [R2StorageService, CompetitorImageService],
})
export class StorageModule {}
