import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class ListBaseProductsQueryDto {
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

  /** Busca por EAN, descrição ou princípio ativo (substring). */
  @IsOptional()
  @IsString()
  public search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  public missingActiveIngredient?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  public generic?: string;
}

export class UpdateBaseProductDto {
  /** `null` limpa o princípio ativo. */
  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.activeIngredient !== null)
  @IsString()
  @Length(1, 255)
  public activeIngredient?: string | null;

  @IsOptional()
  @IsBoolean()
  public generic?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  public description?: string;
}

export class RenameActiveIngredientDto {
  @IsString()
  @Length(1, 255)
  public from!: string;

  @IsString()
  @Length(1, 255)
  public to!: string;
}
