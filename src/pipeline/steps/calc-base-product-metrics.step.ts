import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class CalcBaseProductMetricsStep {
  private readonly logger = new Logger(CalcBaseProductMetricsStep.name);
  public run(
    _em: EntityManager,
    _integration: DataSource | null,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`[stub] calc-base-product-metrics for ${tenantId}`);
    return Promise.resolve();
  }
}
