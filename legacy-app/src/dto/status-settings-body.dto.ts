import { IsNumber, IsOptional } from 'class-validator';

export class UpdateStatusSettingsBodyDto {
  @IsOptional()
  @IsNumber()
  public suspectBelow?: number;

  @IsOptional()
  @IsNumber()
  public attentionBelow?: number;

  @IsOptional()
  @IsNumber()
  public attentionAbove?: number;

  @IsOptional()
  @IsNumber()
  public suspectAbove?: number;
}

