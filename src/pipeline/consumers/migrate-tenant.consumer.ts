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
    createQueueIfNotExists: false,
    queue: MIGRATE_TENANT_QUEUE,
    queueOptions: { channel: 'migrate-tenant' },
  })
  public handle(message: MigrateTenantMessage): void {
    this.logger.log(`Migrating tenant ${message.tenantSlug}`);
    // Runtime-aware: prod runs compiled JS (ts-node pruned), dev runs
    // .ts via ts-node through the npm script.
    const cmd = __dirname.includes('/dist/')
      ? `node dist/scripts/migrate-tenant.js ${message.tenantSlug}`
      : `npm run migration:tenant ${message.tenantSlug}`;
    execSync(cmd, { stdio: 'inherit' });
  }
}
