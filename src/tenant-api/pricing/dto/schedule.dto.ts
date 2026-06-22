import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { ApplyItemDto } from './apply.dto';

/**
 * Agenda uma aplicação one-shot: em `runAt`, aplica os `items` (preços
 * congelados). Reusa ApplyItemDto (ean/target/price/cadernoId).
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
}
