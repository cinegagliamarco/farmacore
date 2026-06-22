import { IsArray, IsOptional, IsString, Length } from 'class-validator';

/**
 * Body de create/update de cluster. Sem `eans` = só renomeia; com `eans` =
 * substitui a membership inteira. EANs são re-validados/dedup no service.
 */
export class UpsertClusterDto {
  @IsString()
  @Length(1, 120)
  public name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public eans?: string[];
}
