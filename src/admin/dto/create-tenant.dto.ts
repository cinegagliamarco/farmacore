import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,31}$/, {
    message: 'slug must be lowercase kebab-case, 3-32 chars, starting with a letter',
  })
  slug!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsEmail()
  adminEmail!: string;
}
