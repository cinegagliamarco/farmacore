import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { SchedulingAction } from '../common/scheduling-action.enum';

export class CreateSchedulingBodyDto {
  @IsNotEmpty()
  @IsDateString()
  public executionDate: string;

  @IsNotEmpty()
  @IsNumber()
  public baseProductId: number;

  @IsNotEmpty()
  @IsEnum(SchedulingAction)
  public action: SchedulingAction;

  @IsNotEmpty()
  @IsString()
  public value: string;
}

