import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { UpdatePriceRoundingRuleBodyDto, CreatePriceRoundingDecimalRangeDto } from '../dto/price-rounding-rule-body.dto';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';
import { PriceRoundingDecimalRangeTypeormEntity } from '../database/entities/price-rounding-decimal-range.entity';

@Injectable()
export class UpdatePriceRoundingRuleUseCase {
  constructor(private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository) {}

  public async execute(id: number, dto: UpdatePriceRoundingRuleBodyDto): Promise<PriceRoundingRuleTypeormEntity> {
    const existingRule = await this.priceRoundingRuleRepository.findById(id);
    if (!existingRule) {
      throw new NotFoundException(`Price rounding rule with id ${id} not found`);
    }

    const newPriceRangeMin = dto.priceRangeMin ?? existingRule.priceRangeMin;
    const newPriceRangeMax = dto.priceRangeMax ?? existingRule.priceRangeMax;

    if (newPriceRangeMin > newPriceRangeMax) {
      throw new BadRequestException('priceRangeMin must be less than or equal to priceRangeMax');
    }

    if (dto.priceRangeMin !== undefined || dto.priceRangeMax !== undefined) {
      const overlappingRules = await this.priceRoundingRuleRepository.findOverlappingRules(newPriceRangeMin, newPriceRangeMax, id);

      if (overlappingRules.length) {
        const overlappingRanges = overlappingRules.map((r) => `${r.priceRangeMin} - ${r.priceRangeMax}`).join(', ');
        throw new ConflictException(
          `Price range ${newPriceRangeMin} - ${newPriceRangeMax} overlaps with existing rule(s) ranges: ${overlappingRanges}`
        );
      }
    }

    if (dto.priceRangeMin !== undefined) existingRule.priceRangeMin = dto.priceRangeMin;
    if (dto.priceRangeMax !== undefined) existingRule.priceRangeMax = dto.priceRangeMax;
    if (dto.active !== undefined) existingRule.active = dto.active;

    if (dto.decimalRanges !== undefined) {
      this.validateDecimalRangesDoNotOverlap(dto.decimalRanges);

      await this.priceRoundingRuleRepository.deleteDecimalRangesByRuleId(id);

      existingRule.decimalRanges = dto.decimalRanges.map((dr) => {
        const decimalRange = new PriceRoundingDecimalRangeTypeormEntity();
        decimalRange.priceRoundingRuleId = id;
        decimalRange.decimalRangeFrom = dr.decimalRangeFrom;
        decimalRange.decimalRangeTo = dr.decimalRangeTo;
        decimalRange.roundTo = dr.roundTo;
        return decimalRange;
      });
    }

    return this.priceRoundingRuleRepository.save(existingRule);
  }

  private validateDecimalRangesDoNotOverlap(decimalRanges: CreatePriceRoundingDecimalRangeDto[]): void {
    for (let i = 0; i < decimalRanges.length; i++) {
      for (let j = i + 1; j < decimalRanges.length; j++) {
        const rangeA = decimalRanges[i];
        const rangeB = decimalRanges[j];

        if (rangeA.decimalRangeFrom <= rangeB.decimalRangeTo && rangeB.decimalRangeFrom <= rangeA.decimalRangeTo) {
          throw new BadRequestException(
            `Decimal ranges overlap: range ${i + 1} (${rangeA.decimalRangeFrom} - ${rangeA.decimalRangeTo}) ` +
              `and range ${j + 1} (${rangeB.decimalRangeFrom} - ${rangeB.decimalRangeTo})`
          );
        }
      }
    }
  }
}
