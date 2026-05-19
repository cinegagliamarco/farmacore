import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class GenerateDescriptionsBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  public baseProductIds: number[];
}
