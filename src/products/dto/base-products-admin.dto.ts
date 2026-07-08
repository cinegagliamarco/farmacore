import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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

  /** Busca por EAN, descrição ou princípio ativo (substring literal). */
  @IsOptional()
  @IsString()
  @Length(1, 100)
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

  /** `null` limpa a descrição. */
  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.description !== null)
  @IsString()
  @Length(1, 500)
  public description?: string | null;

  // Peso (kg) e medidas (cm) — `null` limpa. Os @Max batem com a precisão
  // das colunas (weight numeric(10,3), medidas numeric(10,4)); sem eles um
  // valor acima disso estoura o numeric no UPDATE e viraria 500 em vez de 400.
  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.weight !== null)
  @IsNumber()
  @Min(0)
  @Max(9999999.999)
  public weight?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.height !== null)
  @IsNumber()
  @Min(0)
  @Max(999999.9999)
  public height?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.length !== null)
  @IsNumber()
  @Min(0)
  @Max(999999.9999)
  public length?: number | null;

  @IsOptional()
  @ValidateIf((o: UpdateBaseProductDto) => o.width !== null)
  @IsNumber()
  @Min(0)
  @Max(999999.9999)
  public width?: number | null;
}

export class RenameActiveIngredientDto {
  @IsString()
  @Length(1, 255)
  public from!: string;

  @IsString()
  @Length(1, 255)
  public to!: string;
}
