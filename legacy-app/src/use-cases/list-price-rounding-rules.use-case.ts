import { Injectable } from '@nestjs/common';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { GetPriceRoundingRulesQueryParamDto } from '../dto/price-rounding-rule-query-param.dto';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';

@Injectable()
export class ListPriceRoundingRulesUseCase {
  constructor(private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository) {}

  public async execute(filters: GetPriceRoundingRulesQueryParamDto): Promise<{ rows: PriceRoundingRuleTypeormEntity[]; count: number }> {
    const [rows, count] = await this.priceRoundingRuleRepository.findPaginated(filters.page, filters.perPage, { active: filters.active });
    return { rows, count };
  }
}
