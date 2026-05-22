import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AmqpInterceptor } from './amqp.interceptor';
import { LoggerInterceptor } from './logger.interceptor';

@Module({
  providers: [
    { provide: APP_INTERCEPTOR, useClass: AmqpInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggerInterceptor },
  ],
})
export class InterceptorModule {}
