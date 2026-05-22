import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class SyncBaseProductStep {
  private readonly logger = new Logger(SyncBaseProductStep.name);
  public run(_em: EntityManager, _integration: DataSource | null, tenantId: string): Promise<void> {
    this.logger.log(`[stub] sync-base-product for ${tenantId}`);
    return Promise.resolve();
  }
}
