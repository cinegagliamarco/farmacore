import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerInterceptor } from './logger.interceptor';

@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: LoggerInterceptor }],
})
export class InterceptorModule {}
