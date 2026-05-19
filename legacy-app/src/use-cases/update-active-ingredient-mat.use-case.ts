import { Injectable } from '@nestjs/common';
import { ActiveIngredientsRepository } from '../database/repositories/active-ingredients.repository';

@Injectable()
export class UpdateActiveIngredientMatUseCase {
  constructor(private readonly activeIngredientsRepository: ActiveIngredientsRepository) {}

  public async execute(): Promise<void> {
    await this.activeIngredientsRepository.updateMatFromBaseProducts();
  }
}
