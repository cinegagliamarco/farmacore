import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query do `GET /pricing/suggestions`. Filtros de array/boolean chegam como
 * string ('books' csv, 'onlyWithSuggestion' 'true') e são parseados no service,
 * igual ao catalog (mantém o ValidationPipe global simples).
 */
export class ListSuggestionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  public perPage?: number;

  @IsOptional()
  @IsString()
  public name?: string;

  // Id EXTERNO da loja (tenant_store.external_id, numérico — igual ao catalog).
  // Presente: preços/custos/ofertas da loja + só regras participantes dela.
  // Ausente: visão base (globais) + só regras sem escopo de loja.
  @IsOptional()
  @IsString()
  public store?: string;

  @IsOptional()
  @IsString()
  public classification?: string;

  @IsOptional()
  @IsString()
  public books?: string; // csv: "Caderno A,Caderno B"

  @IsOptional()
  @IsString()
  public onlyWithSuggestion?: string; // 'true'

  @IsOptional()
  @IsIn(['todas', 'subir', 'abaixar'])
  public direction?: string;

  @IsOptional()
  @IsIn(['todas', 'cluster', 'classificacao'])
  public origem?: string;
}
