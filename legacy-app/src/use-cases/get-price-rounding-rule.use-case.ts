import { Injectable, NotFoundException } from '@nestjs/common';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';

@Injectable()
export class GetPriceRoundingRuleUseCase {
  constructor(private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository) {}

  public async execute(id: number): Promise<PriceRoundingRuleTypeormEntity> {
    const rule = await this.priceRoundingRuleRepository.findById(id);
    if (!rule) {
      throw new NotFoundException(`Price rounding rule with id ${id} not found`);
    }
    return rule;
  }
}
