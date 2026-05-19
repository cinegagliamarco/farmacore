import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['activeIngredient', 'matActiveIngredient'] as const;
export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ProductsByActiveIngredientFilters {
  activeIngredient?: string;
  sortBy?: SortableColumn;
  sortDirection?: SortDirection;
}

export class GetProductsByActiveIngredientQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsString()
  public activeIngredient?: string;

  @IsOptional()
  @IsEnum(SORTABLE_COLUMNS, { message: `sortBy must be one of: ${SORTABLE_COLUMNS.join(', ')}` })
  public sortBy?: SortableColumn;

  @IsOptional()
  @IsEnum(SORT_DIRECTIONS, { message: `sortDirection must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  public sortDirection?: SortDirection;
}

