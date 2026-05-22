import { IsEmail, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 256)
  password!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9-]{2,31}$/, {
    message: 'tenantSlug must be a valid slug',
  })
  tenantSlug!: string;
}
