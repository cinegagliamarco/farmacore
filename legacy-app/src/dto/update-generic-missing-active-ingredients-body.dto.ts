import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateGenericMissingActiveIngredientsBodyDto {
  @IsNotEmpty()
  @IsString()
  public activeIngredient: string;
}

