import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * page/perPage compartilhados dos GETs paginados. Sem a coerção+validação de
 * inteiro, `?page=abc` chega ao SQL como LIMIT/OFFSET NaN e vira 500.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public perPage?: number;
}

/** Query do `GET /pricing/audit`: filtros + paginação. */
export class ListAuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  public entity?: string;

  @IsOptional()
  @IsString()
  public entityId?: string;
}
