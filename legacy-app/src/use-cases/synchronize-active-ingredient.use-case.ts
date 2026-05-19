import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SYNCHRONIZE_ACTIVE_INGREDIENTS_USE_CASE } from '../common/import.events';
import { ActiveIngredientsRepository } from '../database/repositories/active-ingredients.repository';
import { PrincipioAtivoRepository } from '../database/integration-repositories/principio-ativo.repository';

@Injectable()
export class SynchronizeActiveIngredientUseCase {
  private readonly BATCH_SIZE = 100;

  constructor(
    private readonly activeIngredientsRepository: ActiveIngredientsRepository,
    private readonly principioAtivoRepository: PrincipioAtivoRepository
  ) {}

  @OnEvent(SYNCHRONIZE_ACTIVE_INGREDIENTS_USE_CASE)
  public async execute(): Promise<void> {
    console.log('Starting active ingredients synchronization');

    try {
      let page = 0;
      let processedCount = 0;
      let hasMore = true;

      while (hasMore) {
        console.log(`Processing batch: page ${page}`);
        const [principiosAtivos, total] = await this.principioAtivoRepository.findPaginated(page, this.BATCH_SIZE);

        if (principiosAtivos.length === 0) {
          hasMore = false;
          continue;
        }

        const activeIngredients = principiosAtivos.map((principioAtivo) => ({
          name: principioAtivo.nome,
          externalId: principioAtivo.id
        }));

        await this.activeIngredientsRepository.upsertBatch(activeIngredients);

        processedCount += principiosAtivos.length;
        console.log(`Processed ${processedCount} of ${total} active ingredients...`);

        if ((page + 1) * this.BATCH_SIZE >= total) {
          hasMore = false;
        } else {
          page++;
        }
      }

      console.log(`Active ingredients synchronization completed. Total processed: ${processedCount}`);
    } catch (error) {
      console.error(`Error during active ingredients synchronization: ${error.message}`);
      throw error;
    }
  }
}
