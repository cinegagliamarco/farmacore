import { IsOptional, IsArray, Validate } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsValidColumn } from '../controllers/validators/is-valid-column.validator';

export class ExportProductsQueryParamDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((col: string) => col.trim())
        .filter((col) => col.length > 0);
    }
    return value;
  })
  @IsArray()
  @Validate(IsValidColumn, { each: true })
  columns?: string[];
}

