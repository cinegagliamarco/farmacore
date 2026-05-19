import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidationOptions } from 'class-validator';

/**
 * Transforms string boolean values ("true"/"false") to actual booleans
 * and validates the result is a boolean.
 *
 * Use this decorator for query parameters that should be booleans.
 *
 * @example
 * ```typescript
 * @IsOptional()
 * @IsBooleanString()
 * public generic?: boolean;
 * ```
 */
export function IsBooleanString(validationOptions?: ValidationOptions) {
  return applyDecorators(
    Transform(({ value }) => {
      if (value === 'true' || value === true) return true;
      if (value === 'false' || value === false) return false;
      return value;
    }),
    IsBoolean(validationOptions)
  );
}

