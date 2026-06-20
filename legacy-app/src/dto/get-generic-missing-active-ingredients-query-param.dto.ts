import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { parseSortDirectionList, parseSortList, SORT_DIRECTIONS, SortDirection } from './multi-sort';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['id', 'ean', 'name', 'supplier'];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export interface GenericMissingActiveIngredientsFilters {
  eans?: number[];
  name?: string;
  supplier?: string;
}

export class GetGenericMissingActiveIngredientsQueryParamDto extends PaginationQueryParamDto {
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
  public eans?: number[];

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsString()
  public supplier?: string;
}

