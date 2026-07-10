import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { EXCHANGE_NAME, MIGRATE_TENANT_QUEUE } from '../../queue/constants';
import { runTenantMigration } from '../../tenant/run-tenant-migration';

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
  public async handle(message: MigrateTenantMessage): Promise<void> {
    this.logger.log(`Migrating tenant ${message.tenantSlug}`);
    const { stdout, stderr } = await runTenantMigration(message.tenantSlug);
    if (stdout.trim()) this.logger.log(stdout.trim());
    if (stderr.trim()) this.logger.warn(stderr.trim());
  }
}
