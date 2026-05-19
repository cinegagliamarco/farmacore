import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export class GetClassificationsQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsString()
  public name?: string;
}
