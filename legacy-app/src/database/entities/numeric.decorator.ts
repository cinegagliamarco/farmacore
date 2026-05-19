import { Column, ColumnOptions } from 'typeorm';

// Define the transformer logic once here
export const numericTransformer = {
  to(data: number | null): number | null {
    return data;
  },
  from(data: string | null): number | null {
    // Handle nulls and convert string to float
    if (data === null) return null;
    const float = parseFloat(data);
    return isNaN(float) ? null : float;
  }
};

export function NumericColumn(options?: ColumnOptions) {
  const baseOptions: ColumnOptions = {
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericTransformer
  };

  // Only add default: 0 if the column is not nullable
  if (!options?.nullable) {
    baseOptions.default = 0;
  }

  return Column({
    ...baseOptions,
    ...options
  });
}
