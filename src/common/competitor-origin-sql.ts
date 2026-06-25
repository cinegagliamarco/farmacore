import { isKnownOrigin } from '../database/competitor-origin.registry';

/** Whitelist-filtered origins safe for SQL interpolation. */
export function safeOrigins(origins: string[]): string[] {
  return origins.filter(isKnownOrigin);
}

export interface CompetitorJoinSql {
  joins: string;
  selects: string;
}

function alias(i: number): string {
  return `o_${i}`;
}

/** Dynamic LEFT JOINs for competitor prices/metadata per tenant EAN. */
export function buildCompetitorCrossJoins(
  origins: string[],
): CompetitorJoinSql {
  const safe = safeOrigins(origins);
  const joins: string[] = [];
  const selects: string[] = [];
  safe.forEach((origin, i) => {
    const a = alias(i);
    joins.push(
      `LEFT JOIN shared_catalog.product ${a} ON ${a}.ean = p.ean AND ${a}.origin = '${origin}'`,
    );
    selects.push(
      `${a}.price AS "${origin}__price"`,
      `${a}.metadata->>'observation' AS "${origin}__observation"`,
      `(${a}.metadata->>'isPbm') = 'true' AS "${origin}__isPbm"`,
      `${a}.metadata->>'van' AS "${origin}__van"`,
    );
  });
  return {
    joins: joins.join('\n         '),
    selects: selects.join(',\n              '),
  };
}

/** LATERAL joins for each competitor's latest stock snapshot (alias exposes `q`). */
export function buildCompetitorStockLaterals(origins: string[]): {
  joins: string;
  countFilters: string[];
} {
  const safe = safeOrigins(origins);
  const joins: string[] = [];
  const countFilters: string[] = [];
  safe.forEach((origin, i) => {
    const a = alias(i);
    joins.push(
      `LEFT JOIN LATERAL (
         SELECT st.quantity AS q
           FROM shared_catalog.product sp
           JOIN shared_catalog.product_stock st ON st.product_id = sp.id
          WHERE sp.ean = p.ean AND sp.origin = '${origin}'
          ORDER BY st.captured_at DESC LIMIT 1
       ) ${a} ON true`,
    );
    countFilters.push(
      `count(*) FILTER (WHERE ${a}.q > 0)::int AS "${origin}__withStock"`,
    );
  });
  return { joins: joins.join('\n         '), countFilters };
}

export interface MappedCompetitor {
  origin: string;
  price: number | null;
  observation?: string | null;
  isPbm?: boolean;
  van?: string | null;
  stock?: number | null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const COMPETITOR_ROW_SUFFIXES = [
  'price',
  'observation',
  'isPbm',
  'van',
  'stock',
] as const;

/** Removes SQL column aliases (`ORIGIN__price`, …) after mapping to `competitors[]`. */
export function stripCompetitorRowKeys(
  row: Record<string, unknown>,
  origins: string[],
): Record<string, unknown> {
  const out = { ...row };
  for (const origin of safeOrigins(origins)) {
    for (const suffix of COMPETITOR_ROW_SUFFIXES) {
      delete out[`${origin}__${suffix}`];
    }
  }
  return out;
}

export function mapCompetitorsFromRow(
  row: Record<string, unknown>,
  origins: string[],
  fields: {
    price?: boolean;
    observation?: boolean;
    isPbm?: boolean;
    van?: boolean;
    stock?: boolean;
  },
): MappedCompetitor[] {
  return safeOrigins(origins).map((origin) => ({
    origin,
    price: fields.price ? num(row[`${origin}__price`]) : null,
    observation: fields.observation
      ? ((row[`${origin}__observation`] as string) ?? null)
      : undefined,
    isPbm: fields.isPbm ? row[`${origin}__isPbm`] === true : undefined,
    van: fields.van ? ((row[`${origin}__van`] as string) ?? null) : undefined,
    stock: fields.stock ? num(row[`${origin}__stock`]) : undefined,
  }));
}
