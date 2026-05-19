import { IsNotEmpty, IsNumber } from 'class-validator';

export class CreateOfferBodyDto {
  @IsNotEmpty()
  @IsNumber()
  public priceForOffer: number;
}

