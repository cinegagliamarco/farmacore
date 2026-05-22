import { Global, Logger, Module } from '@nestjs/common';
import { INTERNAL_LOGGER_TOKEN } from '../../interfaces';
import { NestInternalLogger } from './nest-internal-logger';

@Global()
@Module({
  providers: [
    {
      provide: INTERNAL_LOGGER_TOKEN,
      useFactory: (): NestInternalLogger => new NestInternalLogger(new Logger('App')),
    },
  ],
  exports: [INTERNAL_LOGGER_TOKEN],
})
export class LoggerModule {}
