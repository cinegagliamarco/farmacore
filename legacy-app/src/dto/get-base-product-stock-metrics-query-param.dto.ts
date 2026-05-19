import { Transform } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { StockStatus } from '../common/stock-status.enum';

export interface StockMetricsFilters {
  books?: string[];
  status?: string[];
  eans?: number[];
  classification?: string;
  name?: string;
  supplier?: string;
  stockStatus?: StockStatus[];
}

export class GetBaseProductStockMetricsQueryParamDto {
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
  @IsArray()
  @IsEnum(StockStatus, { each: true })
  @Transform(({ value }) => (typeof value === 'string' ? [value] : value))
  public stockStatus?: StockStatus[];
}

