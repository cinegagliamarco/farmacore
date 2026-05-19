import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class GetRuleExecutionReportsQueryParamDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  public page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  public perPage?: number;
}
