import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class SyncBaseProductStockStep {
  private readonly logger = new Logger(SyncBaseProductStockStep.name);
  public run(_em: EntityManager, _integration: DataSource | null, tenantId: string): Promise<void> {
    this.logger.log(`[stub] sync-base-product-stock for ${tenantId}`);
    return Promise.resolve();
  }
}
