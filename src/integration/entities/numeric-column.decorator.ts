import { Column, ColumnOptions } from 'typeorm';

// Shared across integration entity folders. PG returns NUMERIC as string
// over the wire; this transformer parses it to JS number at read time.
const numericTransformer = {
  to(data: number | null): number | null {
    return data;
  },
  from(data: string | null): number | null {
    if (data === null) return null;
    const f = parseFloat(data);
    return Number.isNaN(f) ? null : f;
  },
};

export function NumericColumn(options?: ColumnOptions): PropertyDecorator {
  return Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    transformer: numericTransformer,
    ...options,
  });
}
