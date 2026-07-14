import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

/** Editable tenant-product fields. `price` is intentionally NOT here —
 *  price changes go through POST /products/:ean/price (which pushes to the
 *  ERP). Identity facts (princípio ativo, generic, description) are NOT
 *  here either — they live in the internal cadastre, curated via
 *  /admin/catalog/base-products. curve/book/mat are deferred (see TODO.md). */
export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 500) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() monitored?: boolean;
  @IsOptional() @IsString() @Length(1, 500) supplier?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsNumber() @Min(0) averageUnitCost?: number;
  @IsOptional() @IsNumber() @Min(0) unitSalePrice?: number;
  @IsOptional() @IsUUID() classificationId?: string;
}

export class UpdatePriceDto {
  @IsNumber()
  @Min(0)
  public newPrice!: number;

  /** Target store (core.tenant_store id). Resolved to its external_id and
   *  sent to the ERP as idUnidadeNegocioPreco. */
  @IsUUID()
  public storeId!: string;
}

export class UpsertOfferDto {
  /** Offer price pushed to the caderno (precoOferta). */
  @IsNumber() @Min(0) public targetPrice!: number;

  /** A7Pharma caderno de ofertas id (idCadernoOferta). Inteiro: vira `::bigint`
   *  na query de participação — um decimal aqui viraria 500, não 400. */
  @IsInt() public cadernoId!: number;

  @IsOptional() @IsString() @Length(1, 500) public description?: string;

  /** Quando presente, a oferta é escopada à loja (core.tenant_store id): o
   *  caderno é RESOLVIDO do product_item daquela loja (offer_external_id),
   *  ignorando `cadernoId` — lojas em cadernos distintos recebem escritas em
   *  cadernos distintos. Pula o espelho global offer_book; 409 se a loja não
   *  tem caderno para o produto. Como o ERP escreve por CADERNO (não por loja),
   *  a resposta devolve as lojas co-afetadas — o alcance honesto da escrita. */
  @IsOptional() @IsUUID() public storeId?: string;
}
