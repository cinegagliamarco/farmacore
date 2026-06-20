import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { BaseProductOrigin } from '../common/base-product-origin.enum';
import { IsBooleanString } from '../controllers/validators/is-boolean-string.validator';
import { parseSortDirectionList, parseSortList, SORT_DIRECTIONS, SortDirection } from './multi-sort';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const BASE_PRODUCT_SORTABLE_COLUMNS = ['ean', 'name', 'supplier', 'mat', 'curve', 'updatedDate'] as const;

export type BaseProductSortableColumn = (typeof BASE_PRODUCT_SORTABLE_COLUMNS)[number];

export const CURVE_VALUES = ['A', 'B', 'C', 'D'] as const;
export type CurveValue = (typeof CURVE_VALUES)[number];

export interface BaseProductFilters {
  curve?: CurveValue[];
  name?: string;
  eans?: number[];
  generic?: boolean;
  origin?: BaseProductOrigin;
  classification?: string;
  active?: boolean;
}

export class GetBaseProductsQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsArray()
  @IsEnum(BASE_PRODUCT_SORTABLE_COLUMNS, { each: true, message: `each sortBy value must be one of: ${BASE_PRODUCT_SORTABLE_COLUMNS.join(', ')}` })
  @Transform(({ value }) => parseSortList(value))
  public sortBy?: BaseProductSortableColumn[];

  @IsOptional()
  @IsArray()
  @IsEnum(SORT_DIRECTIONS, { each: true, message: `each sortDirection value must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  @Transform(({ value }) => parseSortDirectionList(value))
  public sortDirection?: SortDirection[];

  @IsOptional()
  @IsArray()
  @IsEnum(CURVE_VALUES, { each: true, message: `curve values must be one of: ${CURVE_VALUES.join(', ')}` })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  public curve?: CurveValue[];

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string') return [Number(value)];
    if (Array.isArray(value)) return value.map(Number);
    return value;
  })
  public eans?: number[];

  @IsOptional()
  @IsEnum(BaseProductOrigin, { message: `origin must be one of: ${Object.values(BaseProductOrigin).join(', ')}` })
  public origin?: BaseProductOrigin;

  @IsOptional()
  @IsBooleanString()
  public generic?: boolean;

  @IsOptional()
  @IsString()
  public classification?: string;

  @IsOptional()
  @IsBooleanString()
  public active?: boolean;
}
