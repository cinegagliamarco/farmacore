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

export interface MappedCompetitor {
  origin: string;
  price: number | null;
  observation?: string | null;
  isPbm?: boolean;
  van?: string | null;
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
  }));
}
