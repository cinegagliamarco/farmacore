import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { IsBooleanString } from '../controllers/validators/is-boolean-string.validator';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['id', 'name', 'active', 'startDate', 'expirationDate'];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface OfferBookInfoFilters {
  active?: boolean;
  name?: string;
  startDate?: string;
  expirationDate?: string;
}

export class GetOfferBookInfoQueryParamDto extends PaginationQueryParamDto {
  @IsOptional()
  @IsEnum(SORTABLE_COLUMNS, { message: `sortBy must be one of: ${SORTABLE_COLUMNS.join(', ')}` })
  public sortBy?: SortableColumn;

  @IsOptional()
  @IsEnum(SORT_DIRECTIONS, { message: `sortDirection must be one of: ${SORT_DIRECTIONS.join(', ')}` })
  public sortDirection?: SortDirection;

  @IsOptional()
  @IsBooleanString()
  public active?: boolean;

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsDateString({}, { message: 'startDate must be a valid date in YYYY-MM-DD format' })
  public startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expirationDate must be a valid date in YYYY-MM-DD format' })
  public expirationDate?: string;
}
