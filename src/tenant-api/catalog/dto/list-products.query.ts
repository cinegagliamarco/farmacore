import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  parseSortDirectionList,
  parseSortList,
  SORT_DIRECTIONS,
  SortDirection,
} from '../../../common/multi-sort';

const SORTABLE_COLUMNS = [
  'ean',
  'name',
  'supplier',
  'classification',
  'book',
  'cost',
  'price',
  'margin',
  'averageVariation',
  'status',
  'priceOffer',
  'receiptDate',
] as const;
export type SortableColumn = (typeof SORTABLE_COLUMNS)[number];

/**
 * Query for the tenant catalog reads (`/products` and `/products/crossed`).
 * Array/boolean filters arrive as comma-separated / 'true'|'false' strings
 * and are parsed in the service (keeps the global ValidationPipe simple).
 */
export class ListProductsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  public perPage?: number;

  @IsOptional()
  @IsString()
  public name?: string;

  @IsOptional()
  @IsString()
  public supplier?: string;

  @IsOptional()
  @IsString()
  public classification?: string;

  @IsOptional()
  @IsString()
  public status?: string; // comma-separated: OK,ATENÇÃO,SUSPEITA

  // Comma-separated digit lists — they hit `p.ean = ANY($?::bigint[])`, so
  // junk would crash the cast with 500 (same spirit as receiptFrom/To below).
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,18}(\s*,\s*\d{1,18})*$/, {
    message: 'eans must be a comma-separated list of numeric EANs',
  })
  public eans?: string;

  @IsOptional()
  @IsString()
  public monitored?: string; // 'true' | 'false'

  @IsOptional()
  @IsString()
  public active?: string; // 'true' | 'false' — ativo/inativo no ERP

  // Date filters arrive as ISO calendar dates; `@IsString` alone lets junk
  // (e.g. "abc") pass to Postgres and crash the cast with 500. `@Matches` rejects
  // anything that isn't strictly `YYYY-MM-DD`.
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'receiptFrom must be YYYY-MM-DD' })
  public receiptFrom?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'receiptTo must be YYYY-MM-DD' })
  public receiptTo?: string;

  @IsOptional()
  @IsString()
  public activeIngredient?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(SORTABLE_COLUMNS, {
    each: true,
    message: `each sortBy value must be one of: ${SORTABLE_COLUMNS.join(', ')}`,
  })
  @Transform(({ value }) => parseSortList(value))
  public sortBy?: SortableColumn[];

  @IsOptional()
  @IsArray()
  @IsEnum(SORT_DIRECTIONS, {
    each: true,
    message: `each sortDirection value must be one of: ${SORT_DIRECTIONS.join(', ')}`,
  })
  @Transform(({ value }) => parseSortDirectionList(value))
  public sortDirection?: SortDirection[];

  // Store external id. Required by the decision endpoints; optional on the
  // grids (list/crossed/strategic-price/export), where it projects the
  // store's product_item price/cost over the globals.
  @IsOptional()
  @IsString()
  public store?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  public tolerance?: number; // % vs competitor treated as "ok"; default 0

  @IsOptional()
  @IsIn(['subir', 'abaixar', 'ok', 'mix', 'sem-estoque'])
  public decision?: string;
}
