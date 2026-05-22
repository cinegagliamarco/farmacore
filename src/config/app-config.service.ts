import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  get nodeEnv(): string {
    return this.config.getOrThrow('NODE_ENV');
  }
  get port(): number {
    return Number(this.config.getOrThrow('PORT'));
  }
  get isWorker(): boolean {
    return this.config.get('WORKER_MODE') === '1';
  }
  get databaseUrl(): string {
    return this.config.getOrThrow('DATABASE_URL');
  }
  get databaseDirectUrl(): string {
    return this.config.getOrThrow('DATABASE_DIRECT_URL');
  }
  get amqpUrl(): string {
    return this.config.getOrThrow('AMQP_URL');
  }
  get jwtSecret(): string {
    return this.config.getOrThrow('JWT_SECRET');
  }
  get integrationDbKey(): Buffer {
    return Buffer.from(
      this.config.getOrThrow<string>('INTEGRATION_DB_KEY'),
      'base64',
    );
  }
  get r2(): {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    keyPrefix: string;
  } {
    return {
      endpoint: this.config.getOrThrow('R2_ENDPOINT'),
      accessKeyId: this.config.getOrThrow('R2_ACCESS_KEY_ID'),
      secretAccessKey: this.config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      bucket: this.config.getOrThrow('R2_BUCKET'),
      keyPrefix: this.config.get('R2_KEY_PREFIX') ?? '',
    };
  }
}
