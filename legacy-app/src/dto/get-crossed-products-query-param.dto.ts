import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = [
  'id',
  'ean',
  'name',
  'supplier',
  'classification',
  'book',
  'cost',
  'priceForSell',
  'priceForOffer',
  'margin',
  'averageVariation',
  'status',
  'receiptDate'
];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ProductFilters {
  books?: string[];
  status?: string[];
  eans?: number[];
  classification?: string;
  name?: string;
  supplier?: string;
  startReceiptDate?: string;
  endReceiptDate?: string;
}

export class GetCrossedProductsQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsEnum(SORTABLE_COLUMNS, { message: `sortBy must be one of: ${SORTABLE_COLUMNS.join(', ')}` })
  public sortBy?: SortableColumn;

  @IsOptional()
  @IsEnum(SORT_DIRECTIONS, { message: `sortDirection must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  public sortDirection?: SortDirection;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  public books?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  public status?: string[];

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
  @IsString()
  public classification?: string;

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsString()
  public supplier?: string;

  @IsOptional()
  @IsString()
  public startReceiptDate?: string;

  @IsOptional()
  @IsString()
  public endReceiptDate?: string;
}

