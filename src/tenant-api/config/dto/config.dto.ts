import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class VariationStatusDto {
  @IsOptional() @IsNumber() suspectBelow?: number;
  @IsOptional() @IsNumber() attentionBelow?: number;
  @IsOptional() @IsNumber() attentionAbove?: number;
  @IsOptional() @IsNumber() suspectAbove?: number;
}

export class OfferDefaultsDto {
  /** Caderno de oferta padrão do tenant (idCadernoOferta A7); null limpa. É o
   *  alvo da oferta de produtos sem caderno próprio. */
  @ValidateIf((o: OfferDefaultsDto) => o.defaultCadernoId !== null)
  @IsInt()
  @Min(1)
  defaultCadernoId!: number | null;
}

// Bounds mirror the DB column limits: price band numeric(10,2),
// decimal buckets numeric(4,2). Keeps an out-of-range value a 400, not a
// Postgres overflow 500. Cross-field ordering is checked in the service.
export class PriceRoundingRuleDto {
  @IsNumber() @Min(0) @Max(99.99) decimalMin!: number;
  @IsNumber() @Min(0) @Max(99.99) decimalMax!: number;
  @IsNumber() @Min(0) @Max(99.99) roundTo!: number;
}

export class CreatePriceRoundingRangeDto {
  @IsNumber() @Min(0) @Max(99999999.99) priceMin!: number;
  @IsNumber() @Min(0) @Max(99999999.99) priceMax!: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceRoundingRuleDto)
  rules?: PriceRoundingRuleDto[];
}

export class UpdatePriceRoundingRangeDto {
  @IsOptional() @IsNumber() @Min(0) @Max(99999999.99) priceMin?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(99999999.99) priceMax?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceRoundingRuleDto)
  rules?: PriceRoundingRuleDto[];
}
