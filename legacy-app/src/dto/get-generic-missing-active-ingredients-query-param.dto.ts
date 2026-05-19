import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['id', 'ean', 'name', 'supplier'];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface GenericMissingActiveIngredientsFilters {
  eans?: number[];
  name?: string;
  supplier?: string;
}

export class GetGenericMissingActiveIngredientsQueryParamDto extends PaginationQueryParamDto {
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
  public eans?: number[];

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsString()
  public supplier?: string;
}

