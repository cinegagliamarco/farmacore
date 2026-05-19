import { Injectable } from '@nestjs/common';
import { ActiveIngredientsRepository } from '../database/repositories/active-ingredients.repository';

export interface ActiveIngredients {
  activeIngredients: string[];
}

@Injectable()
export class GetActiveIngredientsUseCase {
  constructor(private readonly activeIngredientsRepository: ActiveIngredientsRepository) {}

  public async execute(): Promise<ActiveIngredients> {
    const activeIngredients = await this.activeIngredientsRepository.getActiveIngredients();
    return { activeIngredients: activeIngredients.map((activeIngredient) => activeIngredient.name) };
  }
}
