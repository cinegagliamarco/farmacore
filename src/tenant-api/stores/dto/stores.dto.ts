import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateIf,
} from 'class-validator';

/** Update a store's `active` flag and/or its cluster. `clusterId: null`
 *  detaches; omitting a field leaves it unchanged. */
export class UpdateStoreDto {
  // @ValidateIf (e não @IsOptional) porque @IsOptional também deixaria passar
  // `active: null`, que escaparia da cota e estouraria na coluna NOT NULL.
  @ValidateIf((o: UpdateStoreDto) => o.active !== undefined)
  @IsBoolean()
  public active?: boolean;

  // @IsOptional() skips validation for null (detach) and undefined (no change),
  // and validates the UUID when a value is present.
  @IsOptional()
  @IsUUID()
  public clusterId?: string | null;
}

/** Create/rename a store cluster. */
export class UpsertStoreClusterDto {
  @IsString()
  @Length(1, 120)
  public name!: string;
}
