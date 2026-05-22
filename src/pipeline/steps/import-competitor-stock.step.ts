import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class ImportCompetitorStockStep {
  private readonly logger = new Logger(ImportCompetitorStockStep.name);
  public run(
    _em: EntityManager,
    _integration: DataSource | null,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`[stub] import-competitor-stock for ${tenantId}`);
    return Promise.resolve();
  }
}
