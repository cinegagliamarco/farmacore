import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { execSync } from 'node:child_process';
import { EXCHANGE_NAME, MIGRATE_TENANT_QUEUE } from '../../queue/constants';

interface MigrateTenantMessage {
  tenantSlug: string;
  publishedAt: string;
}

@Injectable()
export class MigrateTenantConsumer {
  private readonly logger = new Logger(MigrateTenantConsumer.name);

  @RabbitSubscribe({
    exchange: EXCHANGE_NAME,
    routingKey: '*.migrate-tenant',
    queue: MIGRATE_TENANT_QUEUE,
    queueOptions: { channel: 'migrate-tenant', prefetchCount: 10 },
  })
  public handle(message: MigrateTenantMessage): void {
    this.logger.log(`Migrating tenant ${message.tenantSlug}`);
    execSync(`npm run migration:tenant ${message.tenantSlug}`, { stdio: 'inherit' });
  }
}
