import { Injectable, NotFoundException } from '@nestjs/common';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';

@Injectable()
export class DeletePriceRoundingRuleUseCase {
  constructor(private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository) {}

  public async execute(id: number): Promise<void> {
    const existingRule = await this.priceRoundingRuleRepository.findById(id);
    if (!existingRule) {
      throw new NotFoundException(`Price rounding rule with id ${id} not found`);
    }

    await this.priceRoundingRuleRepository.delete(id);
  }
}
