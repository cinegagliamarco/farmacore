import type { DataSource } from 'typeorm';

/** TypeORM `DataSource.query` is untyped; narrow once at the SQL boundary. */
export async function queryRows<T extends Record<string, unknown>>(
  ds: DataSource,
  sql: string,
): Promise<T[]> {
  return await ds.query(sql);
}
