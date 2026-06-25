import { CompetitorOrigin } from './enums/competitor-origin.enum';

/** pt-BR display names — single source for API labels and admin UI. */
export const COMPETITOR_ORIGIN_LABELS: Record<CompetitorOrigin, string> = {
  [CompetitorOrigin.DROGAL]: 'Drogal',
  [CompetitorOrigin.DROGASIL]: 'Drogasil',
  [CompetitorOrigin.PAGUE_MENOS]: 'Pague Menos',
  [CompetitorOrigin.IKESAKI]: 'Ikesaki',
  [CompetitorOrigin.MICHELASSI]: 'Michelassi',
  [CompetitorOrigin.PACHECO]: 'Pacheco',
  [CompetitorOrigin.SAO_PAULO]: 'São Paulo',
  [CompetitorOrigin.VENANCIO]: 'Venâncio',
  [CompetitorOrigin.INDIANA]: 'Indiana',
};

export const ALL_COMPETITOR_ORIGINS = Object.values(CompetitorOrigin);

const KNOWN = new Set<string>(ALL_COMPETITOR_ORIGINS);

export function isKnownOrigin(origin: string): origin is CompetitorOrigin {
  return KNOWN.has(origin);
}

export function originLabel(origin: string): string {
  return COMPETITOR_ORIGIN_LABELS[origin as CompetitorOrigin] ?? origin;
}
