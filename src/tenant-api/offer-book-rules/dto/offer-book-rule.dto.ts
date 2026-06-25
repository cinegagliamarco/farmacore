import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CalculationBaseType } from '../../../database/enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../../database/enums/price-base-source.enum';
import {
  CreatePriceLockDto,
  CreatePricingRuleDto,
} from './preview-offer-book-rules.dto';

/** Create a saved rule. Targets products by `eans` XOR `classifications`. */
export class CreateOfferBookRuleDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 200)
  public name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  public description?: string;

  @IsEnum(CalculationBaseType)
  @IsNotEmpty()
  public calculationBaseType!: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @Matches(/^\d+$/, { each: true })
  public eans?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  public classifications?: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleDto)
  public pricingRules!: CreatePricingRuleDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockDto)
  public priceLocks!: CreatePriceLockDto[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;

  @IsOptional()
  @IsBoolean()
  public enabled?: boolean;

  /** A7Pharma idCadernoOferta the execute step writes the offer prices into. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public cadernoId?: number;
}

/** Update a saved rule. Every field optional; arrays replace wholesale. */
export class UpdateOfferBookRuleDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  public name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  public description?: string;

  @IsOptional()
  @IsEnum(CalculationBaseType)
  public calculationBaseType?: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @Matches(/^\d+$/, { each: true })
  public eans?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  public classifications?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleDto)
  public pricingRules?: CreatePricingRuleDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockDto)
  public priceLocks?: CreatePriceLockDto[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;

  @IsOptional()
  @IsBoolean()
  public enabled?: boolean;

  /** A7Pharma idCadernoOferta the execute step writes the offer prices into. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  public cadernoId?: number;
}

export class ListOfferBookRulesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public perPage?: number;

  @IsOptional()
  @IsString()
  public name?: string;

  // Query strings: Boolean('false') is truthy, so coerce explicitly. Preserve
  // undefined (the @Transform runs even when the param is absent).
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === true || value === 'true',
  )
  @IsBoolean()
  public enabled?: boolean;
}

export class ListExecutionReportsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public perPage?: number;

  @IsOptional()
  @IsString()
  public ruleId?: string;

  @IsOptional()
  @IsEnum(['MANUAL', 'SCHEDULED'] as const)
  public executionType?: 'MANUAL' | 'SCHEDULED';

  @IsOptional()
  @IsEnum(['SUCCESS', 'PARTIALLY_SUCCEEDED', 'FAILURE', 'NO_CHANGES'] as const)
  public outcome?: 'SUCCESS' | 'PARTIALLY_SUCCEEDED' | 'FAILURE' | 'NO_CHANGES';

  @IsOptional()
  @IsString()
  public startDate?: string;

  @IsOptional()
  @IsString()
  public endDate?: string;
}

/** Pagination (+ name filter) for a single report's items, and for products. */
export class PaginatedQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public perPage?: number;

  @IsOptional()
  @IsString()
  public name?: string;
}
