import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { parseSortDirectionList, parseSortList, SORT_DIRECTIONS, SortDirection } from './multi-sort';
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
  'status'
];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export interface ProductFilters {
  books?: string[];
  status?: string[];
  eans?: number[];
  classification?: string;
  name?: string;
}

export class GetStrategicPriceQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsArray()
  @IsEnum(SORTABLE_COLUMNS, { each: true, message: `each sortBy value must be one of: ${SORTABLE_COLUMNS.join(', ')}` })
  @Transform(({ value }) => parseSortList(value))
  public sortBy?: SortableColumn[];

  @IsOptional()
  @IsArray()
  @IsEnum(SORT_DIRECTIONS, { each: true, message: `each sortDirection value must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  @Transform(({ value }) => parseSortDirectionList(value))
  public sortDirection?: SortDirection[];

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
}

