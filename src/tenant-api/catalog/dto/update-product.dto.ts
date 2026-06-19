import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

/** Editable tenant-product fields. `price` is intentionally NOT here —
 *  price changes go through POST /products/:ean/price (which pushes to the
 *  ERP). curve/book/mat are deferred (see TODO.md). */
export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 500) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() monitored?: boolean;
  @IsOptional() @IsBoolean() generic?: boolean;
  @IsOptional() @IsString() @Length(1, 500) supplier?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @Length(1, 500) activeIngredient?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsNumber() @Min(0) averageUnitCost?: number;
  @IsOptional() @IsNumber() @Min(0) unitSalePrice?: number;
  @IsOptional() @IsUUID() classificationId?: string;
}

export class UpdatePriceDto {
  @IsNumber()
  @Min(0)
  public newPrice!: number;
}
