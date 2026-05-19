import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PriceRoundingRuleRepository } from '../database/repositories/price-rounding-rule.repository';
import { CreatePriceRoundingRuleBodyDto, CreatePriceRoundingDecimalRangeDto } from '../dto/price-rounding-rule-body.dto';
import { PriceRoundingRuleTypeormEntity } from '../database/entities/price-rounding-rule.entity';
import { PriceRoundingDecimalRangeTypeormEntity } from '../database/entities/price-rounding-decimal-range.entity';

@Injectable()
export class CreatePriceRoundingRuleUseCase {
  constructor(private readonly priceRoundingRuleRepository: PriceRoundingRuleRepository) {}

  public async execute(dto: CreatePriceRoundingRuleBodyDto): Promise<PriceRoundingRuleTypeormEntity> {
    this.validateDecimalRangesDoNotOverlap(dto.decimalRanges);

    const overlappingRules = await this.priceRoundingRuleRepository.findOverlappingRules(dto.priceRangeMin, dto.priceRangeMax);

    if (overlappingRules.length) {
      const overlappingRanges = overlappingRules.map((r) => `${r.priceRangeMin} - ${r.priceRangeMax}`).join(', ');
      throw new ConflictException(
        `Price range ${dto.priceRangeMin} - ${dto.priceRangeMax} overlaps with existing rule(s) ranges: ${overlappingRanges}`
      );
    }

    const rule = new PriceRoundingRuleTypeormEntity();
    rule.priceRangeMin = dto.priceRangeMin;
    rule.priceRangeMax = dto.priceRangeMax;
    rule.active = dto.active ?? true;

    rule.decimalRanges = dto.decimalRanges.map((dr) => {
      const decimalRange = new PriceRoundingDecimalRangeTypeormEntity();
      decimalRange.decimalRangeFrom = dr.decimalRangeFrom;
      decimalRange.decimalRangeTo = dr.decimalRangeTo;
      decimalRange.roundTo = dr.roundTo;
      return decimalRange;
    });

    return this.priceRoundingRuleRepository.save(rule);
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
