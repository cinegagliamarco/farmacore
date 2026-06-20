/**
 * Multi-sort para query params: `?sortBy=a,b&sortDirection=desc,asc`.
 * Posições casam por índice; chaves fora do whitelist são silenciosamente
 * ignoradas (a validação do DTO já rejeita o request inválido).
 */

export const SORT_DIRECTIONS = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

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
 * Monta o trecho do ORDER BY (sem o `ORDER BY ` prefix) para SQL raw.
 * Retorna `fallback` se `sortBy` for vazio ou todas as chaves forem inválidas.
 */
export const buildMultiSortClause = (
  sortBy: string[] | undefined,
  sortDirection: SortDirection[] | undefined,
  columnMap: Record<string, string>,
  fallback: string,
): string => {
  if (!sortBy?.length) return fallback;
  const parts: string[] = [];
  for (let i = 0; i < sortBy.length; i++) {
    const column = columnMap[sortBy[i]];
    if (!column) continue;
    const direction: SortDirection =
      sortDirection?.[i] === 'DESC' ? 'DESC' : 'ASC';
    parts.push(`${column} ${direction}`);
  }
  return parts.length ? parts.join(', ') : fallback;
};
