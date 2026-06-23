import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CompetitorOrigin } from '../../../database/enums/competitor-origin.enum';

export class RuleCompetitorDto {
  @IsIn(Object.values(CompetitorOrigin))
  public competitor!: CompetitorOrigin;

  // weighted: peso % (0<w≤100, checado no service); cascade/lowest: ignorado.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  public weight?: number;
}

/**
 * Body de create/update de uma regra. Validação de campo aqui; as regras
 * cruzadas (classificação XOR cluster, peso por modo, concorrentes ⊆ origens
 * habilitadas, noCompetitorMargin só em concorrência) ficam no service, que
 * espelha o `validate()` do pricy-shelf.
 */
export class UpsertSuggestionRuleDto {
  @IsString()
  @Length(1, 120)
  public name!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  public classifications?: string[];

  @IsOptional()
  @IsUUID()
  public clusterId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  public excludeClusterIds?: string[];

  @IsOptional()
  @IsIn(['margem', 'concorrencia'])
  public strategy?: 'margem' | 'concorrencia';

  @IsNumber()
  @Min(0)
  @Max(95)
  public minMargin!: number;

  @IsOptional()
  @IsIn(['weighted', 'cascade', 'lowest'])
  public competitorMode?: 'weighted' | 'cascade' | 'lowest';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleCompetitorDto)
  public competitors?: RuleCompetitorDto[];

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  public variationPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(95)
  public noCompetitorMargin?: number | null;

  @IsOptional()
  @IsBoolean()
  public priceControlled?: boolean;

  @IsOptional()
  @IsBoolean()
  public ignorePbm?: boolean;

  @IsOptional()
  @IsBoolean()
  public blockPbmInMargin?: boolean;

  @IsOptional()
  @IsBoolean()
  public cascadeByPriority?: boolean;

  @IsOptional()
  @IsBoolean()
  public applyRounding?: boolean;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}
