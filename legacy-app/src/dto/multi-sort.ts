import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * Aceita `?sortBy=a,b`, `?sortBy=a&sortBy=b` ou `?sortBy=a,b&sortBy=c`.
 * Achata, normaliza espaços e descarta vazios.
 */
export const parseSortList = (value: unknown): string[] | undefined => {
  if (value == null || value === '') return undefined;
  const arr = Array.isArray(value) ? value : [value];
  const list = arr
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
};

export const parseSortDirectionList = (value: unknown): string[] | undefined =>
  parseSortList(value)?.map((d) => d.toUpperCase());

/**
 * Aplica ORDER BY múltiplo no QueryBuilder casando posições de `sortBy` com `sortDirection`.
 * Chaves fora da whitelist (`columnMap`) são ignoradas; direções faltantes caem para `ASC`.
 */
export const applyMultiSort = <T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  sortBy: string[] | undefined,
  sortDirection: SortDirection[] | undefined,
  columnMap: Record<string, string>
): boolean => {
  if (!sortBy?.length) return false;
  let applied = false;
  for (let i = 0; i < sortBy.length; i++) {
    const column = columnMap[sortBy[i]];
    if (!column) continue;
    const direction: SortDirection = sortDirection?.[i] === 'DESC' ? 'DESC' : 'ASC';
    if (!applied) qb.orderBy(column, direction);
    else qb.addOrderBy(column, direction);
    applied = true;
  }
  return applied;
};
