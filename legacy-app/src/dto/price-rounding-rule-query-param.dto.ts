import { Type } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export class GetPriceRoundingRulesQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  public active?: boolean;
}
