import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class ImportCompetitorProductsStep {
  private readonly logger = new Logger(ImportCompetitorProductsStep.name);
  public run(
    _em: EntityManager,
    _integration: DataSource | null,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`[stub] import-competitor-products for ${tenantId}`);
    return Promise.resolve();
  }
}
