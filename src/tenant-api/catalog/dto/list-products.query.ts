import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsString()
  public eans?: string; // comma-separated

  @IsOptional()
  @IsString()
  public monitored?: string; // 'true' | 'false'

  @IsOptional()
  @IsString()
  public activeIngredient?: string;

  @IsOptional()
  @IsString()
  public sortBy?: string;

  @IsOptional()
  @IsString()
  public sortDirection?: string; // ASC | DESC
}
