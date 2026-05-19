import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

/**
 * DTO for identifying a product (embalagem) in A7 Pharma API.
 * Only ONE identifier should be provided: idEmbalagem, etiqueta, or codigoBarras.
 */
export class ProductIdentifierBodyDto {
  @IsOptional()
  @IsNumber()
  public idEmbalagem?: number;

  @IsOptional()
  @IsString()
  public etiqueta?: string;

  @IsOptional()
  @IsString()
  public codigoBarras?: string | number;
}

/**
 * DTO for creating/updating an offer in a caderno de ofertas.
 * POST https://ipDoServidor:8443/webapi/api/oferta/?idCadernoOferta=idDoCadernoOferta
 */
export class CreateOrUpdateOfferItemBodyDto extends ProductIdentifierBodyDto {
  @IsOptional()
  @IsNumber()
  public precoOferta?: number | null; // null to remove the item from the offer book
}

export class CreateOrUpdateOfferBodyDto {
  @IsNotEmpty()
  @IsNumber()
  public idCadernoOferta: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrUpdateOfferItemBodyDto)
  public items: CreateOrUpdateOfferItemBodyDto[];
}

/**
 * DTO for removing offers by item IDs.
 * DELETE https://ipDoServidor:8443/webapi/api/oferta/
 */
export class RemoveOffersBodyDto {
  @IsArray()
  @IsNumber({}, { each: true })
  public itemCadernoOfertaIds: number[];
}

/**
 * DTO for changing product prices.
 * POST https://ipDoServidor:8443/webapi/api/preco/?alterarIrmas=false
 */
export class ChangePriceItemBodyDto extends ProductIdentifierBodyDto {
  @IsOptional()
  @IsNumber()
  public precoReferencialNovo?: number;

  @IsOptional()
  @IsNumber()
  public precoVendaNovo?: number;

  @IsOptional()
  @IsNumber()
  public idUnidadeNegocioPreco?: number;
}

export class ChangePricesBodyDto {
  @IsOptional()
  public alterarIrmas?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChangePriceItemBodyDto)
  public items: ChangePriceItemBodyDto[];
}

/**
 * Response types for A7 Pharma API
 */
export interface A7PharmaApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

