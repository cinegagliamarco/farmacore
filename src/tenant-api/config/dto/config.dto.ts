import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class VariationStatusDto {
  @IsOptional() @IsNumber() suspectBelow?: number;
  @IsOptional() @IsNumber() attentionBelow?: number;
  @IsOptional() @IsNumber() attentionAbove?: number;
  @IsOptional() @IsNumber() suspectAbove?: number;
}

export class DecimalRangeDto {
  @IsNumber() minDecimal!: number;
  @IsNumber() maxDecimal!: number;
  @IsNumber() targetDecimal!: number;
}

export class CreatePriceRoundingRuleDto {
  @IsString() @Length(1, 200) name!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DecimalRangeDto)
  ranges?: DecimalRangeDto[];
}

export class UpdatePriceRoundingRuleDto {
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) priority?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DecimalRangeDto)
  ranges?: DecimalRangeDto[];
}
