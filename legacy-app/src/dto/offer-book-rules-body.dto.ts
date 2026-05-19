import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  ArrayMinSize
} from 'class-validator';
import { CalculationBaseType } from '../common/calculation-base-type.enum';
import { DayOfWeek } from '../common/day-of-week.enum';
import { PriceBaseSource } from '../common/price-base-source.enum';
import { PricingActionType } from '../common/pricing-action-type.enum';

function IsValidRange(minProperty: string, maxProperty: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isValidRange',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [minProperty, maxProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [minProp, maxProp] = args.constraints;
          const min = (args.object as Record<string, number>)[minProp];
          const max = (args.object as Record<string, number>)[maxProp];

          if (min !== undefined && max !== undefined && min > max) {
            return false;
          }
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const [minProp, maxProp] = args.constraints;
          return `${minProp} must be less than or equal to ${maxProp}`;
        }
      }
    });
  };
}

/**
 * Pricing Rule DTO
 *
 * Filtering Logic:
 * - Classifications: If provided, only targets products matching those classifications.
 *                    If empty/undefined, applies to all products.
 * - Price Ranges: Can specify min, max, or both to filter by product price.
 *                 If omitted, no price filtering is applied.
 * - Margin Ranges: Can specify min, max, or both to filter by product margin.
 *                  If omitted, no margin filtering is applied.
 * - When both price AND margin ranges are provided, products matching EITHER condition are targeted (OR logic).
 * - If no filters are provided (no classifications, no price/margin ranges), the rule applies to ALL products.
 */
export class CreatePricingRuleBodyDto {
  /**
   * Optional product classifications to target (normalized to second level).
   * If not provided or empty, the rule applies to all products (subject to price/margin ranges).
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  /**
   * Minimum price threshold (inclusive).
   * If only priceRangeMin is provided, targets products with price >= priceRangeMin.
   * Can be combined with priceRangeMax to create a range.
   */
  @IsOptional()
  @IsNumber()
  public priceRangeMin?: number;

  /**
   * Maximum price threshold (inclusive).
   * If only priceRangeMax is provided, targets products with price <= priceRangeMax.
   * Can be combined with priceRangeMin to create a range.
   */
  @IsOptional()
  @IsNumber()
  @IsValidRange('priceRangeMin', 'priceRangeMax')
  public priceRangeMax?: number;

  /**
   * Minimum margin threshold (inclusive).
   * If only marginRangeMin is provided, targets products with margin >= marginRangeMin.
   * Can be combined with marginRangeMax to create a range.
   */
  @IsOptional()
  @IsNumber()
  public marginRangeMin?: number;

  /**
   * Maximum margin threshold (inclusive).
   * If only marginRangeMax is provided, targets products with margin <= marginRangeMax.
   * Can be combined with marginRangeMin to create a range.
   *
   * Note: If neither price nor margin ranges are provided, the rule applies to all products
   * matching the classification filter (or all products if no classifications are specified).
   */
  @IsOptional()
  @IsNumber()
  @IsValidRange('marginRangeMin', 'marginRangeMax')
  public marginRangeMax?: number;

  @IsEnum(PricingActionType)
  @IsNotEmpty()
  public actionType: PricingActionType;

  @IsNumber()
  @IsNotEmpty()
  public percentageValue: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

export class CreatePriceLockBodyDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  @IsNumber()
  @IsNotEmpty()
  public minMargin: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

export class CreateOfferBookRulesBodyDto {
  @IsNumber()
  @IsNotEmpty()
  public offerBookInfoId: number;

  @IsEnum(CalculationBaseType)
  @IsNotEmpty()
  public calculationBaseType: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  public productIds?: number[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  public classifications?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleBodyDto)
  public pricingRules: CreatePricingRuleBodyDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockBodyDto)
  public priceLocks: CreatePriceLockBodyDto[];

  @IsOptional()
  @IsBoolean()
  public scheduleEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  public scheduledDays?: DayOfWeek[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;
}

export class PreviewOfferBookRulesBodyDto {
  @IsEnum(CalculationBaseType)
  @IsNotEmpty()
  public calculationBaseType: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  public productIds?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleBodyDto)
  public pricingRules: CreatePricingRuleBodyDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockBodyDto)
  public priceLocks: CreatePriceLockBodyDto[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;

  @IsOptional()
  @IsNumber()
  public page?: number;

  @IsOptional()
  @IsNumber()
  public pageSize?: number;
}

export interface PreviewProductResult {
  ean: number;
  name: string;
  externalId: number;
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

export interface PaginatedPreviewProductResult {
  rows: PreviewProductResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OfferBookRuleProduct {
  ean: number;
  name: string;
  externalId: number;
  classification: string;
  currentPrice: number;
  currentMargin: number;
  cost: number;
}

export interface PaginatedOfferBookRuleProductResult {
  rows: OfferBookRuleProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class UpdateOfferBookRulesBodyDto {
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
  @IsNumber({}, { each: true })
  public productIds?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public classifications?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleBodyDto)
  public pricingRules?: CreatePricingRuleBodyDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockBodyDto)
  public priceLocks?: CreatePriceLockBodyDto[];

  @IsOptional()
  @IsBoolean()
  public scheduleEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  public scheduledDays?: DayOfWeek[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;
}
