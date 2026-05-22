import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompetitorOrigin } from '../../database/enums/competitor-origin.enum';

export class CompetitorOriginUpdate {
  @IsEnum(CompetitorOrigin)
  origin!: CompetitorOrigin;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateCompetitorOriginsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetitorOriginUpdate)
  origins!: CompetitorOriginUpdate[];
}
