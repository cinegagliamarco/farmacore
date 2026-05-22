import { Module } from '@nestjs/common';
import { LoggerModule } from './logger/logger.module';
import { InterceptorModule } from './interceptors/interceptor.module';

@Module({
  imports: [LoggerModule, InterceptorModule],
  exports: [LoggerModule],
})
export class PresentationModule {}
