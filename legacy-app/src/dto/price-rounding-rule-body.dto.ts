import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
  ValidationArguments
} from 'class-validator';

function IsGreaterThanOrEqual(property: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isGreaterThanOrEqual',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedPropertyName] = args.constraints;
          const relatedValue = (args.object as Record<string, number>)[relatedPropertyName];
          if (typeof value !== 'number' || typeof relatedValue !== 'number') return true;
          return value >= relatedValue;
        },
        defaultMessage(args: ValidationArguments): string {
          const [relatedPropertyName] = args.constraints;
          return `${args.property} must be greater than or equal to ${relatedPropertyName}`;
        }
      }
    });
  };
}

export class CreatePriceRoundingDecimalRangeDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  public decimalRangeFrom: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @IsGreaterThanOrEqual('decimalRangeFrom')
  public decimalRangeTo: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  public roundTo: number;
}

export class CreatePriceRoundingRuleBodyDto {
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  public priceRangeMin: number;

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @IsGreaterThanOrEqual('priceRangeMin')
  public priceRangeMax: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceRoundingDecimalRangeDto)
  public decimalRanges: CreatePriceRoundingDecimalRangeDto[];
}

export class UpdatePriceRoundingRuleBodyDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  public priceRangeMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  public priceRangeMax?: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceRoundingDecimalRangeDto)
  public decimalRanges?: CreatePriceRoundingDecimalRangeDto[];
}
