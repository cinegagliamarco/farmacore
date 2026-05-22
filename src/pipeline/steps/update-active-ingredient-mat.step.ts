import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, DataSource } from 'typeorm';

@Injectable()
export class UpdateActiveIngredientMatStep {
  private readonly logger = new Logger(UpdateActiveIngredientMatStep.name);
  public run(
    _em: EntityManager,
    _integration: DataSource | null,
    tenantId: string,
  ): Promise<void> {
    this.logger.log(`[stub] update-active-ingredient-mat for ${tenantId}`);
    return Promise.resolve();
  }
}
