import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { BaseProductOrigin } from '../common/base-product-origin.enum';
import { IsBooleanString } from '../controllers/validators/is-boolean-string.validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const BASE_PRODUCT_SORTABLE_COLUMNS = ['ean', 'name', 'supplier', 'mat', 'curve', 'updatedDate'] as const;

export type BaseProductSortableColumn = (typeof BASE_PRODUCT_SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

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
  @IsEnum(BASE_PRODUCT_SORTABLE_COLUMNS, { message: `sortBy must be one of: ${BASE_PRODUCT_SORTABLE_COLUMNS.join(', ')}` })
  public sortBy?: BaseProductSortableColumn;

  @IsOptional()
  @IsEnum(SORT_DIRECTIONS, { message: `sortDirection must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  public sortDirection?: SortDirection;

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
