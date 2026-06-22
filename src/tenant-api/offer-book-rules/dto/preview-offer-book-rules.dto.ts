import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  registerDecorator,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { CalculationBaseType } from '../../../database/enums/calculation-base-type.enum';
import { PriceBaseSource } from '../../../database/enums/price-base-source.enum';
import { PricingActionType } from '../../../database/enums/pricing-action-type.enum';

/** Cross-field check: `min <= max` when both bounds are present. */
function IsValidRange(
  minProperty: string,
  maxProperty: string,
  options?: ValidationOptions,
) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: 'isValidRange',
      target: object.constructor,
      propertyName,
      constraints: [minProperty, maxProperty],
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const [minProp, maxProp] = args.constraints as [string, string];
          const obj = args.object as Record<string, number | undefined>;
          const min = obj[minProp];
          const max = obj[maxProp];
          return min === undefined || max === undefined || min <= max;
        },
        defaultMessage(args: ValidationArguments): string {
          const [minProp, maxProp] = args.constraints as [string, string];
          return `${minProp} must be <= ${maxProp}`;
        },
      },
    });
  };
}

/**
 * A pricing rule targets products by classification (prefix, 2-level
 * normalized) and/or price/margin ranges, then applies a discount or
 * increase. No classifications + no ranges = applies to every product.
 */
export class CreatePricingRuleDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  @IsOptional()
  @IsNumber()
  public priceRangeMin?: number;

  @IsOptional()
  @IsNumber()
  @IsValidRange('priceRangeMin', 'priceRangeMax')
  public priceRangeMax?: number;

  @IsOptional()
  @IsNumber()
  public marginRangeMin?: number;

  @IsOptional()
  @IsNumber()
  @IsValidRange('marginRangeMin', 'marginRangeMax')
  public marginRangeMax?: number;

  @IsEnum(PricingActionType)
  @IsNotEmpty()
  public actionType!: PricingActionType;

  // 0–100: a negative value would invert the action (a "discount" that raises
  // the price) and a >100 discount would produce a negative final price.
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @Max(100)
  public percentageValue!: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

/** A price lock enforces a minimum margin floor for the matched products. */
export class CreatePriceLockDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  // 0–99.99: minMargin >= 100 makes the floor `cost / (1 - minMargin/100)`
  // divide by zero/negative; the lock would also silently never apply.
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @Max(99.99)
  public minMargin!: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

export class PreviewOfferBookRulesDto {
  @IsEnum(CalculationBaseType)
  @IsNotEmpty()
  public calculationBaseType!: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  /** Tenant product EANs to preview. Mutually exclusive with `classifications`. */
  // Digits only — they hit `p.ean = ANY($1::bigint[])`, so a non-numeric EAN
  // would be a Postgres cast error (500) instead of a clean 400.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @Matches(/^\d+$/, { each: true })
  public eans?: string[];

  /** Classification path prefixes to preview. Mutually exclusive with `eans`. */
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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public pageSize?: number;
}

export interface PreviewProductResult {
  ean: string;
  name: string;
  externalId: string | null;
  classification: string;
  baseSalePrice: number;
  baseOfferPrice: number;
  currentPrice: number;
  currentMargin: number;
  cost: number;
  actionType: PricingActionType | null;
  percentageValue: number;
  appliedPercentageValue: number;
  finalPrice: number;
  newMargin: number;
  priceLockApplied: boolean;
  discountSkipped: boolean;
  skippedNoCompetitorPrice: boolean;
  skippedPriceExceedsLimit: boolean;
  priceRoundingApplied: boolean;
}

export interface PaginatedPreviewResult {
  rows: PreviewProductResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
