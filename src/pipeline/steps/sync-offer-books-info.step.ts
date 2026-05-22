import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class SyncOfferBooksInfoStep {
  private readonly logger = new Logger(SyncOfferBooksInfoStep.name);
  public run(_em: EntityManager, _integration: DataSource | null, tenantId: string): Promise<void> {
    this.logger.log(`[stub] sync-offer-books-info for ${tenantId}`);
    return Promise.resolve();
  }
}
