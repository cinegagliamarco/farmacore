import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { parseSortDirectionList, parseSortList, SORT_DIRECTIONS, SortDirection } from './multi-sort';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['activeIngredient', 'matActiveIngredient'] as const;
export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export interface ProductsByActiveIngredientFilters {
  activeIngredient?: string;
  sortBy?: SortableColumn[];
  sortDirection?: SortDirection[];
}

export class GetProductsByActiveIngredientQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsString()
  public activeIngredient?: string;

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
}
