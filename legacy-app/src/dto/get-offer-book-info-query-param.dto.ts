import { Transform } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { IsBooleanString } from '../controllers/validators/is-boolean-string.validator';
import { parseSortDirectionList, parseSortList, SORT_DIRECTIONS, SortDirection } from './multi-sort';
import { PaginationQueryParamDto } from './pagination-query-param.dto';

export const SORTABLE_COLUMNS = ['id', 'name', 'active', 'startDate', 'expirationDate'];

export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

export interface OfferBookInfoFilters {
  active?: boolean;
  name?: string;
  startDate?: string;
  expirationDate?: string;
}

export class GetOfferBookInfoQueryParamDto extends PaginationQueryParamDto {
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
