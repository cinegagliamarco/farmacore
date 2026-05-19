import { Transform, Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export interface OfferBookRulesFilters {
  offerBookInfoId?: number;
  productIds?: number[];
  name?: string;
  active?: boolean;
}

export class GetOfferBookRulesQueryParamDto extends PaginationQueryParamDto implements OfferBookRulesFilters {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  public offerBookInfoId?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map(Number);
    if (typeof value === 'string') return value.split(',').map((v) => Number(v.trim()));
    return value;
  })
  @IsArray()
  @IsNumber({}, { each: true })
  public productIds?: number[];

  @IsOptional()
  @IsString()
  public name?: string;
}

export class PreviewSavedOfferBookRulesQueryParamDto extends PaginationQueryParamDto {}

export class GetOfferBookRuleProductsQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsString()
  public name?: string;

  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Max(300)
  @Min(1)
  public perPage: number;
}
