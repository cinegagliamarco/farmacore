import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsDateString } from 'class-validator';
import { ExecutionType } from '../common/execution-type.enum';
import { ExecutionOutcome } from '../common/execution-outcome.enum';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export class GetExecutionReportsQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  public offerBookRulesId?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
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
