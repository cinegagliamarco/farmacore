import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class PaginationQueryParamDto {
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  public page: number;

  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  public perPage: number;
}
