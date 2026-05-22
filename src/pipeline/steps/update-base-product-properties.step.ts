import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class UpdateBaseProductPropertiesStep {
  private readonly logger = new Logger(UpdateBaseProductPropertiesStep.name);
  public run(
    _em: EntityManager,
    _integration: DataSource | null,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`[stub] update-base-product-properties for ${tenantId}`);
    return Promise.resolve();
  }
}
