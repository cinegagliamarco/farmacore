import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplyItemDto {
  // Digits only — EANs hit `ANY($1::bigint[])`, so a non-numeric value would
  // be a Postgres cast error (500) instead of a clean 400; ≤18 digits fits bigint.
  @IsString()
  @Matches(/^\d{1,18}$/)
  public ean!: string;

  @IsIn(['precoVenda', 'precoOferta'])
  public target!: 'precoVenda' | 'precoOferta';

  // Preço APROVADO pelo operador (pode ser override manual). Congelado e
  // validado contra guarda-corpos no service; nunca recalculado-e-aplicado.
  @IsNumber()
  @Min(0)
  public price!: number;

  // Caderno do alvo precoOferta. Se ausente, o service deriva do offer_book.
  @IsOptional()
  @IsInt()
  @Min(1)
  public cadernoId?: number;
}

/** Dry-run do apply: só os itens; nada é persistido nem enfileirado. */
export class PreviewApplyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ApplyItemDto)
  public items!: ApplyItemDto[];
}

/**
 * Aplica preços aprovados em massa. `mode=agora` empurra imediatamente ao ERP
 * via pipeline. `idempotencyKey` torna o reenvio do mesmo POST um no-op.
 */
export class ApplyPricesDto {
  @IsString()
  @Length(1, 200)
  public idempotencyKey!: string;

  @IsOptional()
  @IsIn(['agora'])
  public mode?: 'agora';

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ApplyItemDto)
  public items!: ApplyItemDto[];
}
