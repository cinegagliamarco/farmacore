import { IsInt, Max, Min, ValidateIf } from 'class-validator';

/** `storeLimit: null` remove o limite (lojas ilimitadas). */
export class UpdateTenantStoreLimitDto {
  @ValidateIf((o: UpdateTenantStoreLimitDto) => o.storeLimit !== null)
  @IsInt()
  @Min(1)
  @Max(2147483647) // int4 do Postgres; acima disso o INSERT estoura em 500
  storeLimit!: number | null;
}
