import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { ApplyItemDto } from './apply.dto';

/**
 * Agenda uma aplicação: em `runAt`, aplica os `items`. Por padrão one-shot com
 * preços congelados. `cronExpr` torna recorrente (re-arma após disparar);
 * `recalc` recalcula o preço pelo motor no disparo em vez de usar o congelado.
 */
export class CreateScheduleDto {
  @IsDateString()
  public runAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ApplyItemDto)
  public items!: ApplyItemDto[];

  @IsOptional()
  @IsString()
  @Length(9, 100)
  public cronExpr?: string;

  @IsOptional()
  @IsBoolean()
  public recalc?: boolean;
}
