import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { CalculationBaseType } from '../../../database/enums/calculation-base-type.enum';
import { DayOfWeek } from '../../../database/enums/day-of-week.enum';
import { PriceBaseSource } from '../../../database/enums/price-base-source.enum';
import {
  CreatePriceLockDto,
  CreatePricingRuleDto,
} from './preview-offer-book-rules.dto';

/**
 * Cria o conjunto de regras aplicado a um caderno de ofertas existente.
 * `offerBookInfoId` é o idCadernoOferta que o GET /offer-campaigns lista
 * (não se cria caderno aqui, só se aplica). Os produtos-alvo vêm por `eans`
 * OU `classifications` (subárvore), nunca ambos — igual ao /preview.
 */
export class CreateOfferBookRuleDto {
  @IsInt()
  @Min(1)
  public offerBookInfoId!: number;

  @IsEnum(CalculationBaseType)
  @IsNotEmpty()
  public calculationBaseType!: CalculationBaseType;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PriceBaseSource, { each: true })
  public priceBaseSources?: PriceBaseSource[];

  /** Tenant product EANs. Mutually exclusive with `classifications`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @Matches(/^\d+$/, { each: true })
  public eans?: string[];

  /** Classification IDs (subtree). Mutually exclusive with `eans`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  public classifications?: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePricingRuleDto)
  public pricingRules!: CreatePricingRuleDto[];

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CreatePriceLockDto)
  public priceLocks!: CreatePriceLockDto[];

  @IsOptional()
  @IsBoolean()
  public scheduleEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  public scheduledDays?: DayOfWeek[];

  @IsOptional()
  @IsBoolean()
  public applyPriceRounding?: boolean;
}
