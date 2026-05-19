import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';

export class GetExecutionReportQueryParamDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  public page: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  public perPage: number;

  @IsOptional()
  @IsString()
  public name?: string;
}
