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
    publicDomain: string;
  } {
    return {
      endpoint: this.config.getOrThrow('R2_ENDPOINT'),
      accessKeyId: this.config.getOrThrow('R2_ACCESS_KEY_ID'),
      secretAccessKey: this.config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      bucket: this.config.getOrThrow('R2_BUCKET'),
      keyPrefix: this.config.get('R2_KEY_PREFIX') ?? '',
      publicDomain: this.config.get('R2_PUBLIC_DOMAIN') ?? '',
    };
  }

  get otelDisabled(): boolean {
    return this.config.get('OTEL_DISABLED') === '1';
  }
  get otelServiceName(): string {
    return this.config.get('OTEL_SERVICE_NAME') ?? 'farmacore';
  }
  get otelEndpoint(): string | undefined {
    return this.config.get('OTEL_EXPORTER_OTLP_ENDPOINT');
  }
  get otelHeaders(): string | undefined {
    return this.config.get('OTEL_EXPORTER_OTLP_HEADERS');
  }
  get importVtexEanBatchSize(): number {
    return Number(this.config.get('PIPELINE_IMPORT_VTEX_EAN_BATCH_SIZE') ?? 25);
  }
  get importNonVtexEanBatchSize(): number {
    return Number(this.config.get('PIPELINE_IMPORT_NON_VTEX_EAN_BATCH_SIZE') ?? 1);
  }
  get pipelineDispatchPublishCheckpoint(): number {
    return Number(
      this.config.get('PIPELINE_DISPATCH_PUBLISH_CHECKPOINT') ?? 1000,
    );
  }
  get pipelineDispatchOutboxPublish(): boolean {
    return this.config.get('PIPELINE_DISPATCH_OUTBOX_PUBLISH') === '1';
  }
  /** 0 = no confirm timeout (dispatch/outbox drain paths). */
  get pipelinePublishTimeoutMs(): number {
    const raw = this.config.get('PIPELINE_PUBLISH_TIMEOUT_MS');
    if (raw === undefined || raw === '') return 0;
    return Number(raw);
  }
  get outboxPublisherBatchSize(): number {
    return Number(this.config.get('PIPELINE_OUTBOX_PUBLISHER_BATCH_SIZE') ?? 500);
  }

  get amqpMgmt(): { apiUrl?: string; user?: string; pass?: string } {
    return {
      apiUrl:
        this.config.get('AMQP_MGMT_URL') ??
        this.config.get('CLOUDAMQP_API_URL'),
      user:
        this.config.get('AMQP_MGMT_USER') ??
        this.config.get('CLOUDAMQP_API_USER'),
      pass:
        this.config.get('AMQP_MGMT_PASS') ??
        this.config.get('CLOUDAMQP_API_PASS'),
    };
  }
}
