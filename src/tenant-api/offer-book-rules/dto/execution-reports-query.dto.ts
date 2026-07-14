import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ExecutionOutcome } from '../../../database/enums/execution-outcome.enum';
import { ExecutionType } from '../../../database/enums/execution-type.enum';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public perPage?: number;
}

/** Detalhe do report: paginação obrigatória (a lista de items pode ser enorme). */
export class ReportItemsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public perPage!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  public name?: string;
}

export class ListReportsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4')
  public ruleId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public offerBookInfoId?: number;

  @IsOptional()
  @IsEnum(ExecutionType)
  public executionType?: ExecutionType;

  @IsOptional()
  @IsEnum(ExecutionOutcome)
  public outcome?: ExecutionOutcome;

  @IsOptional()
  @IsDateString()
  public startDate?: string;

  @IsOptional()
  @IsDateString()
  public endDate?: string;
}
