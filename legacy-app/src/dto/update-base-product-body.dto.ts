import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateBaseProductBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @IsOptional()
  @IsNumber()
  public price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public book?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1)
  public curve?: string;

  @IsOptional()
  @IsBoolean()
  public generic?: boolean;

  @IsOptional()
  @IsNumber()
  public averageUnitCost?: number;

  @IsOptional()
  @IsNumber()
  public unitSalePrice?: number;

  @IsOptional()
  @IsString()
  public description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public supplier?: string;

  @IsOptional()
  @IsNumber()
  public classificationId?: number;

  @IsOptional()
  @IsNumber()
  public cost?: number;

  @IsOptional()
  @IsNumber()
  public mat?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  public activeIngredient?: string;

  @IsOptional()
  @IsNumber()
  public weight?: number;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}

