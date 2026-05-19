import { IsNotEmpty, IsNumber } from 'class-validator';

export class UpdatePriceBodyDto {
  @IsNotEmpty()
  @IsNumber()
  public newPrice: number;
}

